"""Lança o recebimento de uma NF a partir do romaneio do PDF (pré-lançamento), no canteiro e linha indicados.

Uso:  python -X utf8 scripts/importar/lancar_nf.py 260720 260721 --linha T4 --canteiro Juazeiro --data 2026-11-24 [--simular]

Só lança se TUDO conferir (senão a NF é recusada e nada é gravado para ela):
  1. PDF da NF no índice; nº do DANFE = nº da NF; romaneio lido com sequência completa e soma do peso = peso líquido do DANFE;
  2. nº de linhas do romaneio = nº de volumes do DANFE;
  3. cada SKU do romaneio é um volume da matriz ligado a EXATAMENTE UM material previsto nesse canteiro/linha;
  4. nenhuma linha de fixador avulso (CM) — de-para de fixadores ainda não existe;
  5. a NF ainda não tem recebimento no banco.
Grava: movimento 'recebimento' (origem 'lancamento:romaneio:NF<n>') + itens, e a NF passa a 'em_conferencia'.
Se depois um controle Excel trouxer a mesma NF, controles.py avisa (o controle não apaga este lançamento).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
from collections import defaultdict
from pathlib import Path

from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar  # noqa: E402
from romaneio import ler_pdf, romaneio_confere  # noqa: E402

PASTA = DADOS / "Notas" / "NFs emitidas"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("nfs", nargs="+")
    ap.add_argument("--linha", required=True)
    ap.add_argument("--canteiro", required=True)
    ap.add_argument("--data", required=True, help="data de recebimento AAAA-MM-DD")
    ap.add_argument("--obs", default=None)
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    data = dt.date.fromisoformat(a.data)
    indice = {r["nf"].strip(): r for r in csv.DictReader(open(PASTA / "_indice.csv", encoding="utf-8-sig"), delimiter=";")}
    conn = conectar()
    cur = conn.cursor()
    cur.execute("select id from public.linha where sigla = %s", (a.linha,)); linha_id = cur.fetchone()[0]
    cur.execute("select id from public.canteiro where nome = %s", (a.canteiro,)); canteiro_id = cur.fetchone()[0]
    ok = True
    for nf in a.nfs:
        probs = []
        r = indice.get(nf)
        x = ler_pdf(PASTA / r["nome"]) if r and (PASTA / r["nome"]).is_file() else {"erro": "PDF não está no índice"}
        if x.get("erro"):
            probs.append(x["erro"])
        else:
            if x["nf"] != nf.lstrip("0"):
                probs.append(f"DANFE diz NF {x['nf']}")
            probs += romaneio_confere(x)
            if x["volumes"] is not None and len(x["romaneio"]) != x["volumes"]:
                probs.append(f"romaneio {len(x['romaneio'])} linhas × DANFE {x['volumes']} volumes")
            if any(i["tipo_ud"] == "CM" for i in x["romaneio"]):
                probs.append("tem fixadores avulsos (CM): de-para de fixadores ainda não existe")
        cur.execute("select n.id, n.situacao, cd.nome, (select count(*) from public.movimento m where m.nota_fiscal_id = n.id) "
                    "from public.nota_fiscal n left join public.canteiro cd on cd.id = n.destino_canteiro_id where n.numero = %s", (nf,))
        row = cur.fetchone()
        if not row:
            probs.append("NF não está no banco")
        elif row[3]:
            probs.append(f"NF já tem {row[3]} recebimento(s) no banco")
        elif row[2] and row[2] != a.canteiro:
            probs.append(f"destino da NF é {row[2]}, não {a.canteiro}")
        itens = defaultdict(float)
        if not probs:
            por_sku = defaultdict(float)
            for i in x["romaneio"]:
                por_sku[i["sku"]] += i["quantidade"]
            cur.execute("""select v.sku, array_agg(distinct m.id), array_agg(distinct m.descricao) from public.volume_matriz v
                           join public.material m on m.volume_matriz_id = v.id
                           join public.previsto p on p.material_id = m.id and p.linha_id = %s and p.canteiro_id = %s
                           where v.sku = any(%s) group by 1""", (linha_id, canteiro_id, list(por_sku)))
            mat = {s: (ids, ds) for s, ids, ds in cur.fetchall()}
            for sku, q in por_sku.items():
                ids, ds = mat.get(sku, ([], []))
                if len(ids) != 1:
                    probs.append(f"SKU {sku}: {len(ids)} materiais previstos em {a.linha} {a.canteiro} {ds}")
                else:
                    itens[ids[0]] += q
        if probs:
            ok = False
            print(f"NF {nf}: RECUSADA — " + "; ".join(probs))
            continue
        cur.execute("select id, descricao, peso_unit from public.material where id = any(%s)", (list(itens),))
        info = {i: (d, p) for i, d, p in cur.fetchall()}
        peso_mat = sum(q * float(info[m][1] or 0) for m, q in itens.items())
        print(f"NF {nf}: CONFERE — {len(x['romaneio'])} volumes, {x['peso_liquido']:.3f} kg (DANFE) · OF {x['oc']} · remessa {x['remessa']}")
        for m, q in itens.items():
            print(f"     {q:g} × {info[m][0]}")
        print(f"     peso pelos pesos unitários cadastrados: {peso_mat:.3f} kg")
        if a.simular:
            continue
        nf_id = row[0]
        origem = f"lancamento:romaneio:NF{nf}"
        obs = a.obs or "Lançada pelo romaneio do PDF (SKU → matriz → volume do controle)."
        cur.execute("""insert into public.movimento (tipo, data, linha_id, canteiro_id, nota_fiscal_id, documento, origem, observacao)
                       values ('recebimento', %s, %s, %s, %s, %s, %s, %s) returning id""",
                    (data, linha_id, canteiro_id, nf_id, f"romaneio remessa {x['remessa']}", origem, obs))
        mid = cur.fetchone()[0]
        execute_values(cur, "insert into public.movimento_item (movimento_id, material_id, quantidade) values %s",
                       [(mid, m, q) for m, q in itens.items()])
        cur.execute("""update public.nota_fiscal set situacao = 'em_conferencia', canteiro_id = %s, recebida_em = %s,
                         peso = coalesce(peso, %s), romaneio = coalesce(romaneio, %s) where id = %s""",
                    (canteiro_id, data, x["peso_liquido"], x["remessa"], nf_id))
    if a.simular:
        conn.rollback(); print("Simulação: nada foi gravado.")
    else:
        conn.commit()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

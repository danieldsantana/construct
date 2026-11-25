"""Grava o romaneio de cada NF emitida (PDF digital) e marca se a leitura confere.

Uso:  python -X utf8 scripts/importar/romaneios.py [--simular]

Para cada NF do índice com PDF: lê DANFE + romaneio (romaneio.py), filtrado pela REMESSA da própria NF.
Confere quando a sequência do romaneio está completa E a soma do peso = peso líquido do DANFE (±0,05 kg) ou, quando o DANFE
não traz peso (ex. NFs de SAC), = "Peso NF" da ENTRADA do controle (±1 kg). Só NF que confere entra na conferência
romaneio × lançamento (view nf_conferencia). As linhas são gravadas mesmo quando não confere (com o motivo), para consulta.
Conferência final: nº de linhas e soma do peso gravados por NF = lidos do PDF.
"""
from __future__ import annotations

import argparse
import re
import csv
import sys
from collections import Counter
from pathlib import Path

from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar  # noqa: E402
from romaneio import ler_pdf, romaneio_confere  # noqa: E402
from matriz import chave, parte_norm  # noqa: E402

PASTA = DADOS / "Notas" / "NFs emitidas"
DESC = re.compile(r"TORRE (.+?) - (C4[A-Z0-9]+|BCTV)\b.*?\(?V(\d+)/(\d+)")
EXPANDE = [(r"\bTR\b", "TRONCO"), (r"\bP\.\s*COMUM\b", "TRONCO COMUM"), (r"\bSUP\b", "SUPERIOR"), (r"\bINF\b", "INFERIOR"),
           (r"\bEXT\b", "EXTENSAO"), (r"\bCABECA\b", "CABECA")]


def comprimento(txt: str) -> str:
    # 'PERNA 9M' -> 'PERNA 9,0M' · 'EXTENSAO 4,5M' fica igual
    return re.sub(r"(\d+)M\b", lambda m: f"{m.group(1)},0M", txt) if not re.search(r"\d,\dM", txt) else txt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    indice = [r for r in csv.DictReader(open(PASTA / "_indice.csv", encoding="utf-8-sig"), delimiter=";") if r["nf"].strip().isdigit()]
    conn = conectar()
    cur = conn.cursor()
    cur.execute("select numero, id, peso from public.nota_fiscal")
    nfs = {n: (i, float(p) if p is not None else None) for n, i, p in cur.fetchall()}
    cur.execute("select id, sku, nome, peso from public.volume_matriz")
    por_sku, por_chave = {}, {}
    for vid, sku, nome, peso in cur.fetchall():
        if sku:
            por_sku[sku] = vid
        k = chave(nome)
        if k:
            por_chave.setdefault(k, []).append((vid, float(peso)))

    def liga(i):
        if i["sku"] in por_sku:
            return por_sku[i["sku"]], "sku"
        if (i["descricao"] or "").startswith("POS "):
            return None, "peca"
        m = DESC.search(i["descricao"] or "")
        if not m:
            return None, None
        parte = m.group(1).upper()
        for a_, b_ in EXPANDE:
            parte = re.sub(a_, b_, parte)
        k = (m.group(2), parte_norm(comprimento(parte)), int(m.group(3)), int(m.group(4)))
        cand = [(vid, peso) for vid, peso in por_chave.get(k, []) if i["peso_unit"] and abs(peso - i["peso_unit"]) <= max(0.05, 0.002 * peso)]
        return (cand[0][0], "nome+peso") if len(cand) == 1 else (None, None)

    st, linhas, marcas = Counter(), [], []
    ligs = Counter()
    for r in indice:
        nf = r["nf"].strip()
        if nf not in nfs or not (PASTA / r["nome"]).is_file():
            st["sem PDF ou fora do banco"] += 1
            continue
        x = ler_pdf(PASTA / r["nome"])
        if x.get("erro"):
            st[x["erro"]] += 1
            continue
        nf_id, peso_ctrl = nfs[nf]
        probs = romaneio_confere(x)
        soma = sum(i["peso_total"] for i in x["romaneio"])
        # sem peso no DANFE: vale o "Peso NF" da ENTRADA do controle, se a sequência estiver completa
        if probs == ["peso do DANFE não lido"] and peso_ctrl is not None and abs(soma - peso_ctrl) <= 1:
            probs = []
        confere = not probs
        st["confere" if confere else probs[0].split(" (")[0][:30]] += 1
        marcas.append((nf_id, confere, "; ".join(probs) or None, x.get("peso_liquido")))
        for i in x["romaneio"]:
            vid, lig = liga(i) if i["tipo_ud"] == "FD" else (None, None)
            if i["tipo_ud"] == "FD":
                ligs[lig or "sem ligação"] += 1
            linhas.append((nf_id, i["seq"], i["remessa"], i["ud"], i["sku"], i["lote"], i["tipo_ud"], i["ov"], i["item_ov"], i["descricao"],
                           i["quantidade"], i["peso_unit"], i["peso_total"], i["pagina"], vid, lig))
    print(dict(st))
    print("linhas FD (volumes) por ligação com a matriz:", dict(ligs))
    ids = [m[0] for m in marcas]
    cur.execute("delete from public.romaneio_item where nota_fiscal_id = any(%s)", (ids,))
    execute_values(cur, """insert into public.romaneio_item (nota_fiscal_id, seq, remessa, ud, sku, lote, tipo_ud, ov, item_ov, descricao,
                           quantidade, peso_unit, peso_total, pagina, volume_matriz_id, ligacao) values %s""", linhas, page_size=2000)
    execute_values(cur, """update public.nota_fiscal n set romaneio_confere = v.c, romaneio_obs = v.o, peso_danfe = v.p
                           from (values %s) v(id, c, o, p) where n.id = v.id""", marcas,
                   template="(%s::integer, %s::boolean, %s::text, %s::numeric)", page_size=1000)
    # conferência: linhas e peso por NF no banco = lidos
    cur.execute("select count(*), coalesce(sum(peso_total), 0) from public.romaneio_item where nota_fiscal_id = any(%s)", (ids,))
    n, p = cur.fetchone()
    if n != len(linhas) or abs(float(p) - sum(x[12] for x in linhas)) > 0.01:
        conn.rollback()
        print(f"NADA gravado: banco {n} linhas / {float(p):.3f} kg × lido {len(linhas)} / {sum(x[12] for x in linhas):.3f}")
        return 1
    if a.simular:
        conn.rollback()
        print("Simulação: nada foi gravado.")
        return 0
    conn.commit()
    print(f"CONFERE → gravado: {len(linhas)} linhas de romaneio de {len(marcas)} NFs ({st['confere']} com leitura conferida)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

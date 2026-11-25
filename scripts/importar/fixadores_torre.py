"""Importa a aba FIXADORES POR TORRE dos controles (necessidade de cada fixador a granel por torre) e confere.

Uso:  python -X utf8 scripts/importar/fixadores_torre.py [--simular]

Conferência por controle (se falhar, aquele controle não é gravado):
  1. soma das colunas das torres = NECESSÁRIO, em cada fixador;
  2. RECEBIDO da aba = recebido do granel (seção FIXADORES) lançado pelo próprio controle;
  3. toda torre da aba existe na LC; todo fixador com necessidade > 0 existe na ENTRADA (seção FIXADORES).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import openpyxl
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, numero_torre  # noqa: E402
from controles import CONTROLES  # noqa: E402


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def ler(arq: Path):
    wb = openpyxl.load_workbook(arq, read_only=True, data_only=True)
    aba = next(n for n in wb.sheetnames if n.upper().startswith("FIXADORES POR TORRE") and "(2)" not in n)
    rows = [list(r) for r in wb[aba].iter_rows(values_only=True)]
    wb.close()
    h = next(i for i, r in enumerate(rows) if any(str(v or "").strip().upper() == "FIXADOR" for v in r[:6]))
    cf = next(j for j, v in enumerate(rows[h]) if str(v or "").strip().upper() == "FIXADOR")
    rot = {str(v).strip().upper(): j for j, v in enumerate(rows[h][:cf + 8]) if v}
    nec, rec = rot.get("NECESSÁRIO", rot.get("NECESSARIO")), rot.get("RECEBIDO")
    torres = [(j, numero_torre(v)) for j, v in enumerate(rows[h]) if j > cf + 5 and numero_torre(v)]
    itens = []
    for r in rows[h + 1:]:
        if not r[cf] or num(r[nec]) is None:
            continue
        por_torre = {t: num(r[j]) or 0.0 for j, t in torres}
        itens.append({"fixador": " ".join(str(r[cf]).split()), "necessario": num(r[nec]), "recebido": num(r[rec]), "torres": por_torre})
    return aba, [t for _, t in torres], itens


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    conn = conectar()
    ok = True
    for arq, linha, canteiro in CONTROLES:
        aba, torres, itens = ler(DADOS / arq)
        difs = []
        with conn.cursor() as cur:
            cur.execute("select t.numero, t.id from public.torre t join public.linha l on l.id = t.linha_id where l.sigla = %s", (linha,))
            ids = dict(cur.fetchall())
            cur.execute("""select m.descricao, m.id, coalesce(sum(i.quantidade) filter (where mv.origem like 'controle:%%'), 0)
                           from public.previsto p join public.material m on m.id = p.material_id
                           join public.linha l on l.id = p.linha_id join public.canteiro c on c.id = p.canteiro_id
                           left join public.movimento mv on mv.linha_id = p.linha_id and mv.canteiro_id = p.canteiro_id
                           left join public.movimento_item i on i.movimento_id = mv.id and i.material_id = m.id
                           where l.sigla = %s and c.nome = %s and m.secao = 'FIXADORES' group by 1, 2""", (linha, canteiro))
            mat = {d: (mid, float(r)) for d, mid, r in cur.fetchall()}
            fora = [t for t in torres if t not in ids]
            if fora:
                difs.append(f"torres fora da LC: {fora[:6]}")
            linhas = []
            for it in itens:
                soma = sum(it["torres"].values())
                if abs(soma - it["necessario"]) > 1e-6:
                    difs.append(f"{it['fixador']}: soma das torres {soma:g} × NECESSÁRIO {it['necessario']:g}")
                if it["necessario"] == 0:
                    continue
                if it["fixador"] not in mat:
                    difs.append(f"{it['fixador']}: necessário {it['necessario']:g} sem material na ENTRADA")
                    continue
                mid, rec_ctrl = mat[it["fixador"]]
                if it["recebido"] is not None and abs(rec_ctrl - it["recebido"]) > 1e-6:
                    difs.append(f"{it['fixador']}: RECEBIDO da aba {it['recebido']:g} × ENTRADA {rec_ctrl:g}")
                linhas += [(ids[t], mid, q, f"controle:{Path(arq).name} · {aba}") for t, q in it["torres"].items() if q and t in ids]
            print(f"{linha} · {canteiro}: {len(torres)} torres · {len(itens)} fixadores · {len(linhas)} necessidades > 0 → "
                  f"{'CONFERE' if not difs else 'DIVERGE'}")
            for d in difs[:8]:
                print("   ", d)
            if difs or a.simular:
                conn.rollback()
                ok = ok and not difs
                continue
            cur.execute("delete from public.torre_fixador where torre_id = any(%s)", ([ids[t] for t in torres if t in ids],))
            execute_values(cur, "insert into public.torre_fixador (torre_id, material_id, quantidade, fonte) values %s", linhas, page_size=2000)
        conn.commit()
    if a.simular:
        print("Simulação: nada foi gravado.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

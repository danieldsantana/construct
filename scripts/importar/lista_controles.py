"""Importa a aba LISTA dos controles (status, sequência de ataque e composição de cada torre) e confere.

Uso:  python scripts/importar/lista_controles.py [--simular]

Conferência por controle (se falhar, aquele controle não é gravado):
  1. toda torre da LISTA existe na LC daquela linha;
  2. (aviso, não bloqueia) torres da LISTA × faixa oficial do canteiro;
  3. a quantidade de "Entregue" é igual ao TOTAL da coluna "TORRES COM ESTRUTURA E FIXADORES" da TABELAS.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import openpyxl
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, numero_torre, sem_acento  # noqa: E402
from controles import CONTROLES  # noqa: E402

# colunas G (6) a AB (27) da LISTA, na ordem
CHAVES = ["AP_PR_ANC", "AP_PR_SUSP", "AP_CABECA", "AP_TRONCO", "AP_EXT", "AP_PERNA_A", "AP_PERNA_B", "AP_PERNA_C", "AP_PERNA_D", "AP_STUB",
          "ES_PR_ANC", "ES_PR_SUSP", "ES_CABECA", "ES_TRONCO_SUP", "ES_EXT_1_5", "ES_EXT_3_0", "ES_EXT_4_5", "ES_EXT_6_0", "ES_EXT_7_5",
          "ES_TRONCO_INF", "ES_CALOTA", "ES_PINO"]


def ler(arq: Path):
    wb = openpyxl.load_workbook(arq, read_only=True, data_only=True)
    aba = next(n for n in wb.sheetnames if n.upper().startswith("LISTA - ") and "COMPLETA" not in n.upper())
    linhas = [list(r) + [None] * 32 for r in wb[aba].iter_rows(values_only=True)]
    # cabeçalho "TORRE" na coluna B (d = 0) ou C (d = 1, layout deslocado do outro analista)
    h, d = next((i, k) for i, r in enumerate(linhas[:8]) for k in (0, 1) if str(r[1 + k] or "").strip().upper() == "TORRE")
    torres = []
    for r in linhas[h + 1:]:
        num = numero_torre(r[1 + d])
        if not num:
            continue
        g = 6 + d  # 1ª coluna de composição (G ou H)
        comp = {k: float(r[g + i]) for i, k in enumerate(CHAVES) if isinstance(r[g + i], (int, float)) and r[g + i]}
        seq = r[28 + d] if isinstance(r[28 + d], (int, float)) else None
        torres.append({"num": num, "tipo": r[2 + d], "status": str(r[5 + d] or "").strip(), "seq": int(seq) if seq is not None else None, "comp": comp})
    aba_t = next(n for n in wb.sheetnames if n.upper().startswith("TABELAS"))
    total_entregue = None
    for r in wb[aba_t].iter_rows(min_row=1, max_row=20, values_only=True):
        if len(r) > 3 and str(r[1] or "").strip().upper().startswith("TOTAL"):
            total_entregue = r[3]
            break
    wb.close()
    return aba, torres, total_entregue


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    conn = conectar()
    ok = True
    for arq, linha, canteiro in CONTROLES:
        aba, torres, total = ler(DADOS / arq)
        entregues = sum(1 for t in torres if sem_acento(t["status"]) == "ENTREGUE")
        difs = []
        with conn.cursor() as cur:
            cur.execute("select t.numero, t.id from public.torre t join public.linha l on l.id = t.linha_id where l.sigla = %s", (linha,))
            ids = dict(cur.fetchall())
            cur.execute("select numero from public.torre_detalhe where linha_sigla = %s and canteiro = %s", (linha, canteiro))
            faixa = {x[0] for x in cur.fetchall()}
            fora_lc = [t["num"] for t in torres if t["num"] not in ids]
            lista = {t["num"] for t in torres}
            if fora_lc:
                difs.append(f"torres da LISTA que não existem na LC: {fora_lc[:8]}")
            aviso = None
            if lista != faixa:  # diferença entre duas fontes (controle × distribuição oficial): avisa, não bloqueia
                aviso = f"aviso: LISTA × faixa oficial do canteiro — só na LISTA {sorted(lista - faixa)[:8]} · só na faixa {sorted(faixa - lista)[:8]}"
            if total is not None and entregues != total:
                difs.append(f"Entregue na LISTA = {entregues} × TOTAL da TABELAS = {total}")
            print(f"{linha} · {canteiro} ({aba}): {len(torres)} torres · {entregues} Entregue (TABELAS: {total}) · "
                  f"status {sorted({t['status'] for t in torres})} → {'CONFERE' if not difs else 'DIVERGE'}")
            for d in difs + ([aviso] if aviso else []):
                print("   ", d)
            if difs or a.simular:
                conn.rollback()
                ok = ok and not difs
                continue
            execute_values(cur, """insert into public.torre_controle (torre_id, status, sequencia, composicao, fonte) values %s
                                   on conflict (torre_id) do update set status = excluded.status, sequencia = excluded.sequencia,
                                     composicao = excluded.composicao, fonte = excluded.fonte""",
                           [(ids[t["num"]], t["status"], t["seq"], json.dumps(t["comp"]), f"controle:{Path(arq).name} · {aba}") for t in torres])
        conn.commit()
    if a.simular:
        print("Simulação: nada foi gravado.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

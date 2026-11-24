"""Importa as OFs emitidas pelo cliente (aba "OFs BRAMETAL" do resumo de OFs), só T3 e T4.

Uso:  python scripts/importar/ofs.py [--simular]

Conferência (se falhar, nada é gravado):
  1. soma de QUANT. e PESO TOTAL de todos os itens (todas as linhas do lote) = totais da linha 9 da planilha;
  2. cada OF tem um único valor de revisão, data, entrega, linha e canteiro em todos os seus itens;
  3. depois de gravar: itens, quantidade e peso de cada OF no banco = planilha.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import openpyxl
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, numero, numero_of, sem_acento  # noqa: E402

ARQ = DADOS / "OF e controles cliente" / "Lote 01 - Resumo OFs_29.10.26.xlsx"
ABA = "OFs BRAMETAL"
LINHA_DA_LT = {"LT CS 500KV JUAZEIRO III - CAMPO FORMOSO II C1": "T4", "LT CS 500KV CAMPO FORMOSO II - BARRA II C1": "T3"}
# canteiro da planilha (sem acento, sem " - BA") -> nome no banco
CANTEIRO = {"LAJES DOS NEGROS": "Laje dos Negros"}


def data(v):
    return v.date() if isinstance(v, dt.datetime) else v if isinstance(v, dt.date) else None


def ler():
    wb = openpyxl.load_workbook(ARQ, read_only=True, data_only=True)
    ws = wb[ABA]
    total = next(ws.iter_rows(min_row=9, max_row=9, values_only=True))
    itens, soma_q, soma_p = [], Decimal(0), Decimal(0)
    for r in ws.iter_rows(min_row=12, values_only=True):
        if not r[1]:
            continue
        q, p = numero(r[10]) or Decimal(0), numero(r[11]) or Decimal(0)
        soma_q += q
        soma_p += p
        linha = LINHA_DA_LT.get(sem_acento(r[5]))
        if not linha:
            continue  # outras linhas do lote: fora do escopo
        itens.append({"codigo": str(r[1]).strip(), "seq": r[0] if isinstance(r[0], int) else None, "rev": r[2] if isinstance(r[2], int) else None,
                      "emitida": data(r[3]), "entrega": data(r[4]), "entrega_txt": None if data(r[4]) else (str(r[4]).strip() if r[4] else None),
                      "linha": linha, "canteiro": sem_acento(r[14] or "").replace(" - BA", "").strip(),
                      "tipo": str(r[8]).strip(), "desc": str(r[7]).strip(), "un": r[9], "q": q, "p": p})
    wb.close()
    return itens, (soma_q, soma_p), (numero(total[10]), numero(total[11]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    itens, (sq, sp), (tq, tp) = ler()
    difs = []
    if sq != tq or abs(sp - tp) > Decimal("0.5"):
        difs.append(f"soma dos itens (qtd {sq}, peso {sp}) × total da linha 9 (qtd {tq}, peso {tp})")
    ofs = defaultdict(list)
    for it in itens:
        ofs[it["codigo"]].append(it)
    cab = {}
    for cod, its in ofs.items():
        campos = {k: {it[k] for it in its} for k in ("rev", "emitida", "entrega", "entrega_txt", "linha", "canteiro")}
        varia = [k for k, v in campos.items() if len(v) > 1]
        if varia:
            difs.append(f"{cod}: valores diferentes entre os itens em {varia}")
        cab[cod] = {k: next(iter(v)) for k, v in campos.items()}
    por_linha = defaultdict(int)
    for it in itens:
        por_linha[it["linha"]] += 1
    print(f"{ABA}: {len(itens)} itens T3/T4 ({dict(por_linha)}) em {len(ofs)} OFs · soma geral qtd {sq} / peso {sp:.1f} × linha 9: {tq} / {tp:.1f}")

    conn = conectar()
    with conn.cursor() as cur:
        cur.execute("select sigla, id from public.linha"); linha_id = dict(cur.fetchall())
        cur.execute("select nome, id from public.canteiro"); canteiros = {sem_acento(n): i for n, i in cur.fetchall()}
        cid = {}
        for cod, c in cab.items():
            nome = sem_acento(CANTEIRO.get(c["canteiro"], c["canteiro"]))
            if nome not in canteiros:
                difs.append(f"{cod}: canteiro '{c['canteiro']}' não cadastrado")
            cid[cod] = canteiros.get(nome)
        if difs:
            for d in difs:
                print("   DIVERGE:", d)
            print("NADA gravado.")
            return 1
        if a.simular:
            print("Simulação: confere; nada foi gravado.")
            return 0
        fonte = f"{ARQ.name} · {ABA}"
        execute_values(cur, """
            insert into public.ordem_fabricacao (codigo, numero, revisao, emitida_em, entrega_prevista, entrega_texto, linha_id, canteiro_id, fonte)
            values %s on conflict (codigo) do update set numero = excluded.numero, revisao = excluded.revisao, emitida_em = excluded.emitida_em,
              entrega_prevista = excluded.entrega_prevista, entrega_texto = excluded.entrega_texto, linha_id = excluded.linha_id,
              canteiro_id = excluded.canteiro_id, fonte = excluded.fonte""",
            [(cod, numero_of(cod), c["rev"], c["emitida"], c["entrega"], c["entrega_txt"], linha_id[c["linha"]], cid[cod], fonte) for cod, c in cab.items()])
        cur.execute("select codigo, id from public.ordem_fabricacao where codigo = any(%s)", (list(ofs),))
        of_id = dict(cur.fetchall())
        cur.execute("delete from public.of_item where of_id = any(%s)", (list(of_id.values()),))
        execute_values(cur, "insert into public.of_item (of_id, seq, tipo_torre, descricao, unidade, quantidade, peso_kg) values %s",
                       [(of_id[it["codigo"]], it["seq"], it["tipo"], it["desc"], it["un"], it["q"], it["p"]) for it in itens], page_size=1000)
        cur.execute("""select o.codigo, count(i.id), sum(i.quantidade), sum(i.peso_kg) from public.ordem_fabricacao o
                       join public.of_item i on i.of_id = o.id where o.codigo = any(%s) group by 1""", (list(ofs),))
        banco = {r[0]: r[1:] for r in cur.fetchall()}
        erro = [cod for cod, its in ofs.items()
                if banco.get(cod) != (len(its), sum(i["q"] for i in its), sum(i["p"] for i in its))]
        if erro:
            conn.rollback()
            print("NADA gravado: banco × planilha diferem em", erro[:8])
            return 1
    conn.commit()
    print(f"CONFERE → gravado: {len(ofs)} OFs, {len(itens)} itens")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Importa as NFs emitidas a partir do índice dos PDFs recebidos por e-mail
("Dados criação/Notas/NFs emitidas/_indice.csv", gerado pelo script do usuário que separa os lotes).

Uso:  python scripts/importar/nfs_emitidas.py [--simular]

- NF que ainda não existe no banco entra como "não recebida", com destino, arquivo, SAC e RNC.
- NF que já veio de um controle (recebida) só ganha arquivo, destino, SAC e RNC; a situação não muda.
Conferência: toda NF do índice tem de estar no banco com o arquivo; senão nada é gravado.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
from pathlib import Path

from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar  # noqa: E402

INDICE = DADOS / "Notas" / "NFs emitidas" / "_indice.csv"
LINHA_DA_SIGLA = {"CAFII-BRRII": "T3", "JZTIII-CAFII": "T4"}  # 'ND' = reposição sem linha definida


def data(s):
    try:
        return dt.datetime.strptime(s.strip(), "%d/%m/%Y").date()
    except (ValueError, AttributeError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    linhas = list(csv.DictReader(open(INDICE, encoding="utf-8-sig"), delimiter=";"))
    por_nf = {}
    for r in linhas:
        nf = r["nf"].strip()
        if nf.isdigit():
            por_nf.setdefault(nf, r)  # se repetida, vale a primeira
    repetidas = len([r for r in linhas if r["nf"].strip().isdigit()]) - len(por_nf)
    print(f"índice: {len(linhas)} linhas · {len(por_nf)} NFs distintas" + (f" · {repetidas} repetidas" if repetidas else ""))
    if a.simular:
        print("Simulação: nada foi gravado.")
        return 0

    conn = conectar()
    with conn.cursor() as cur:
        cur.execute("select sigla, id from public.linha"); linha_id = dict(cur.fetchall())
        cur.execute("select nome, id from public.canteiro"); canteiro_id = dict(cur.fetchall())
        sem_canteiro = sorted({r["local"] for r in por_nf.values() if r["local"] and r["local"] not in canteiro_id})
        if sem_canteiro:
            print("   aviso: locais do índice sem canteiro cadastrado (ficam sem destino):", ", ".join(sem_canteiro))
        cur.execute("select numero from public.nota_fiscal"); existentes = {x[0] for x in cur.fetchall()}
        execute_values(cur, """
            insert into public.nota_fiscal (numero, emissao, fornecedor, linha_id, destino_canteiro_id, arquivo, sac, rnc, origem)
            values %s
            on conflict (numero) do update set
              emissao = coalesce(public.nota_fiscal.emissao, excluded.emissao),
              fornecedor = coalesce(public.nota_fiscal.fornecedor, excluded.fornecedor),
              linha_id = coalesce(public.nota_fiscal.linha_id, excluded.linha_id),
              destino_canteiro_id = excluded.destino_canteiro_id,
              arquivo = excluded.arquivo, sac = excluded.sac, rnc = excluded.rnc""",
            [(nf, data(r["emissao"]), (r["fornecedor"] or "").upper() or None, linha_id.get(LINHA_DA_SIGLA.get(r["sigla"], "")),
              canteiro_id.get(r["local"]), r["nome"], r["sac"] or None, r["rnc"] or None, f"pdf:{r['nome']}")
             for nf, r in por_nf.items()], page_size=1000)
        # conferência
        cur.execute("select numero, arquivo from public.nota_fiscal where numero = any(%s)", (list(por_nf),))
        no_banco = dict(cur.fetchall())
        faltando = [nf for nf in por_nf if no_banco.get(nf) != por_nf[nf]["nome"]]
        cur.execute("select situacao, count(*) from public.nota_fiscal where arquivo is not null group by 1 order by 1")
        sit = dict(cur.fetchall())
        cur.execute("select count(*) from public.nota_fiscal where arquivo is null")
        sem_pdf = cur.fetchone()[0]
    if faltando:
        conn.rollback()
        print(f"NADA gravado: {len(faltando)} NFs do índice não conferem no banco (ex.: {faltando[:5]})")
        return 1
    conn.commit()
    novas = len(set(por_nf) - existentes)
    print(f"CONFERE → gravado: {len(por_nf)} NFs do índice ({novas} novas, {len(por_nf) - novas} já vinham dos controles)")
    print(f"   situação das NFs com PDF: {sit} · NFs recebidas sem PDF no índice: {sem_pdf}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

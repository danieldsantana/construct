"""Lê dos PDFs das NFs emitidas (DANFE digital) a OF ("OC:") e a remessa, e completa as NFs do banco.

Uso:  python scripts/importar/nfs_pdf.py [--simular]

- Só lê a 1ª e a 2ª página (DANFE). PDF só imagem ou sem "OC:" fica de fora (listado no fim).
- Conferência por PDF: o número da NF impresso no DANFE tem de ser o mesmo do nome do arquivo
  (senão o PDF é ignorado e aparece como divergência).
- OF e remessa só são gravadas onde o banco não tem valor. Onde o controle já tem OF/romaneio e o PDF
  diz outra coisa, nada é trocado: a diferença é listada (controle × PDF) para o usuário decidir.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, numero_of  # noqa: E402

PASTA = DADOS / "Notas" / "NFs emitidas"
INDICE = PASTA / "_indice.csv"


def ler_pdf(caminho: Path):
    d = fitz.open(caminho)
    t = "".join(d[i].get_text() for i in range(min(2, len(d))))
    d.close()
    if len(t.strip()) < 50:
        return {"erro": "PDF só imagem"}
    # DANFE SAP (atual): "SÉRIE\n257057\n" · "OC:OF-... Número Contrato" · "REMESSA: 0080060146"
    # DANFE Protheus (antigo, até ~nov/2025): "N. 000229602\nSÉRIE 1" · "OF-71607-EM-BRM-18 ROMANEIO: 045473"
    nf = re.search(r"S[ÉE]RIE\n(\d+)\n", t) or re.search(r"N\. (\d+)\nS[ÉE]RIE", t)
    oc = re.search(r"OC:\s*(.*?)\s+N[úu]mero Contrato", t) or re.search(r"(OF-[^\n]*?)\s+ROMANEIO:", t)
    rem = re.search(r"REMESSA:\s*(\d+)", t) or re.search(r"ROMANEIO:\s*(\d+)", t)
    return {"nf": nf.group(1).lstrip("0") if nf else None, "oc": " ".join(oc.group(1).split()) if oc else None,
            "remessa": rem.group(1).lstrip("0") if rem else None}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    indice = [r for r in csv.DictReader(open(INDICE, encoding="utf-8-sig"), delimiter=";") if r["nf"].strip().isdigit()]
    lidos, fora, divergentes = {}, [], []
    for r in indice:
        nf, nome = r["nf"].strip(), r["nome"]
        p = PASTA / nome  # o índice traz o caminho relativo (ex. "SAC/NF...pdf")
        if not p.is_file():
            fora.append((nf, "arquivo não encontrado")); continue
        x = ler_pdf(p)
        if x.get("erro"):
            fora.append((nf, x["erro"])); continue
        if x["nf"] != nf.lstrip("0"):
            divergentes.append(f"{nome}: DANFE diz NF {x['nf']}"); continue
        if not x["oc"]:
            fora.append((nf, "sem OC: no DANFE")); continue
        lidos.setdefault(nf, x)
    print(f"índice: {len(indice)} NFs · PDFs lidos com OF: {len(lidos)} · sem OF: {len(fora)} · NF do DANFE ≠ arquivo: {len(divergentes)}")
    for d in divergentes:
        print("   DIVERGE:", d)

    conn = conectar()
    with conn.cursor() as cur:
        cur.execute("select numero, of_texto, of_numero, romaneio, of_fonte from public.nota_fiscal where numero = any(%s)", (list(lidos),))
        banco = {r[0]: r[1:] for r in cur.fetchall()}
        preencher, conflitos = [], []
        for nf, x in lidos.items():
            if nf not in banco:
                continue
            of_txt, of_num, romaneio, fonte = banco[nf]
            novo_num = numero_of(x["oc"])
            if of_txt is not None and fonte == "controle" and of_num != novo_num:
                conflitos.append(f"NF {nf}: controle {of_txt} × PDF {x['oc']}")
            if romaneio and x["remessa"] and romaneio.lstrip("0") != x["remessa"]:
                conflitos.append(f"NF {nf}: romaneio controle {romaneio} × PDF {x['remessa']}")
            preencher.append((nf, x["oc"], novo_num, x["remessa"]))
        if not a.simular:
            execute_values(cur, """
                update public.nota_fiscal n set
                  of_texto = case when n.of_fonte = 'controle' then n.of_texto else v.oc end,
                  of_numero = case when n.of_fonte = 'controle' then n.of_numero else v.num::integer end,
                  of_fonte = case when n.of_fonte = 'controle' then 'controle' else 'pdf' end,
                  romaneio = coalesce(n.romaneio, v.rem)
                from (values %s) as v(nf, oc, num, rem) where n.numero = v.nf""", preencher, page_size=1000)
            # conferência: toda NF lida tem OF no banco (do controle ou do PDF)
            cur.execute("select count(*) from public.nota_fiscal where numero = any(%s) and of_texto is null", ([p[0] for p in preencher],))
            faltam = cur.fetchone()[0]
            if faltam:
                conn.rollback()
                print(f"NADA gravado: {faltam} NFs lidas continuam sem OF no banco")
                return 1
            cur.execute("select of_fonte, count(*) from public.nota_fiscal group by 1 order by 1")
            print("   OF das NFs no banco por fonte:", dict(cur.fetchall()))
    if a.simular:
        conn.rollback()
        print("Simulação: nada foi gravado.")
    else:
        conn.commit()
        print(f"CONFERE → {len(preencher)} NFs atualizadas (OF/remessa só onde faltava)")
    print(f"   controle × PDF diferentes ({len(conflitos)}):")
    for c in conflitos[:30]:
        print("     ", c)
    print("   sem OF no PDF:", ", ".join(f"{nf} ({m})" for nf, m in fora[:20]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

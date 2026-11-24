"""Importa a matriz de embalagem padronizada (aba BASE) e liga os volumes dos controles aos da matriz.

Uso:  python -X utf8 scripts/importar/matriz.py [--simular]

1. volume_matriz (um por VOLUME, peso = soma do PESO TOTAL das posições) e posicao_matriz (uma por linha da BASE).
   Conferência: nº de linhas e soma do PESO TOTAL no banco = planilha.
2. material.volume_matriz_id: o nome do controle é normalizado (PÉ = PERNA, EXT = EXTENSÃO, CABECA = CABEÇA,
   'EMB C4EP (CABEÇA - C4EP) (VOL.4/8)' = 'C4EP - CABEÇA (4/8)', TRONCO SUP = TRONCO COMUM SUPERIOR…) e SÓ é ligado
   se o peso unitário do controle bate com o da matriz (tolerância 0,05 kg ou 0,1%). O resto é listado, não ligado.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, sem_acento  # noqa: E402

ARQ = DADOS / "Matrizes de embalagem e escalonamento" / "MATRIZES DE EMBALAGEM - PADRONIZADAS.xlsx"
TIPO = r"(C4[A-Z0-9]+|BCTV)"
FORMATO_T3 = re.compile(rf"^{TIPO} - (.+?) \((\d+)/(\d+)\)$")                      # C4EL - CABEÇA (1/8)
FORMATO_T4 = re.compile(rf"^EMB {TIPO} \((.+?) - {TIPO}\) \(VOL\.? ?(\d+)/(\d+)\)$")  # EMB C4EP (CABEÇA - C4EP) (VOL.4/8)
TROCAS = [  # parte normalizada (sem acento, maiúsculas)
    (r"^PE\b", "PERNA"), (r"^EXT\b\.?", "EXTENSAO"), (r"(\d) M$", r"\1M"),
    (r"^TRONCO COMUM SUP$", "TRONCO COMUM SUPERIOR"), (r"^TRONCO COMUM INF$", "TRONCO COMUM INFERIOR"),
    (r"^TRONCO SUPERIOR$", "TRONCO COMUM SUPERIOR"), (r"^TRONCO INFERIOR$", "TRONCO COMUM INFERIOR"),
    (r"^TRONCO$", "TRONCO COMUM"),
]


def parte_norm(p: str) -> str:
    s = sem_acento(p)
    for a, b in TROCAS:
        s = re.sub(a, b, s)
    return " ".join(s.split())


def chave(nome: str):
    """(tipo, parte normalizada, k, N) ou None."""
    n = " ".join(str(nome).split())
    m = FORMATO_T3.match(n)
    if m:
        return m.group(1), parte_norm(m.group(2)), int(m.group(3)), int(m.group(4))
    m = FORMATO_T4.match(sem_acento(n).replace("EMB ", "EMB ", 1)) or FORMATO_T4.match(n)
    if m and m.group(1) == m.group(3):
        return m.group(1), parte_norm(m.group(2)), int(m.group(4)), int(m.group(5))
    return None


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def ler():
    wb = openpyxl.load_workbook(ARQ, read_only=True, data_only=True)
    vols, posicoes, soma = {}, [], 0.0
    for r in wb["BASE"].iter_rows(min_row=2, values_only=True):
        if not r[3]:
            continue
        nome = " ".join(str(r[3]).split())
        v = vols.setdefault(nome, {"tipo": r[0], "cat": r[1], "parte": r[2], "tv": r[4], "sku": set(), "peso": 0.0})
        if r[5]:
            v["sku"].add(str(r[5]).strip())
        pt = num(r[15]) or 0.0
        v["peso"] += pt
        soma += pt
        posicoes.append((nome, r[6] if isinstance(r[6], int) else None, r[7], r[8], num(r[9]), r[10], r[11], num(r[12]), num(r[13]),
                         num(r[14]), num(r[15]), str(r[17]) if r[17] is not None else None))
    wb.close()
    return vols, posicoes, soma


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    vols, posicoes, soma = ler()
    varios_sku = [n for n, v in vols.items() if len(v["sku"]) > 1]
    print(f"BASE: {len(posicoes)} posições · {len(vols)} volumes · peso total {soma:.1f} kg"
          + (f" · ATENÇÃO {len(varios_sku)} volumes com mais de um SKU" if varios_sku else ""))
    conn = conectar()
    with conn.cursor() as cur:
        execute_values(cur, """
            insert into public.volume_matriz (nome, tipo_torre, categoria, parte, tipo_volume, sku, ordem, total, peso, fonte) values %s
            on conflict (nome) do update set tipo_torre = excluded.tipo_torre, categoria = excluded.categoria, parte = excluded.parte,
              tipo_volume = excluded.tipo_volume, sku = excluded.sku, ordem = excluded.ordem, total = excluded.total,
              peso = excluded.peso, fonte = excluded.fonte""",
            [(n, v["tipo"], v["cat"], v["parte"], v["tv"], next(iter(v["sku"])) if len(v["sku"]) == 1 else None,
              *(chave(n)[2:] if chave(n) else (None, None)), round(v["peso"], 4), f"{ARQ.name} · BASE") for n, v in vols.items()])
        cur.execute("select nome, id from public.volume_matriz"); vid = dict(cur.fetchall())
        cur.execute("delete from public.posicao_matriz")
        execute_values(cur, """insert into public.posicao_matriz (volume_id, item, posicao, cod_posicao_sap, quantidade, tipo_material, material,
                               comprimento_mm, largura_mm, peso_unit, peso_total, cod_parte_sap) values %s""",
                       [(vid[p[0]], *p[1:]) for p in posicoes], page_size=2000)
        cur.execute("select count(*), coalesce(sum(peso_total), 0) from public.posicao_matriz")
        n_banco, peso_banco = cur.fetchone()
        if n_banco != len(posicoes) or abs(float(peso_banco) - soma) > 0.5:
            conn.rollback()
            print(f"NADA gravado: banco {n_banco} posições / {float(peso_banco):.1f} kg × planilha {len(posicoes)} / {soma:.1f} kg")
            return 1
        print(f"CONFERE: {n_banco} posições, {float(peso_banco):.1f} kg")

        # ---- ligação material (controle) → volume da matriz ----
        por_chave = defaultdict(list)
        for n, v in vols.items():
            k = chave(n)
            if k:
                por_chave[k].append((n, v["peso"]))
        cur.execute("select id, descricao, peso_unit from public.material where parte is not null")
        ligar, peso_difere, sem_par, nao_lido = [], [], [], []
        for mid, desc, pu in cur.fetchall():
            k = chave(desc)
            if not k:
                nao_lido.append(desc); continue
            cand = por_chave.get(k, [])
            if len(cand) != 1:
                sem_par.append(desc); continue
            nome, peso = cand[0]
            if pu is None or abs(float(pu) - peso) > max(0.05, 0.001 * peso):
                peso_difere.append(f"{desc} → {nome}: controle {pu} × matriz {peso:.3f}"); continue
            ligar.append((mid, vid[nome]))
        cur.execute("update public.material set volume_matriz_id = null where parte is not null")
        execute_values(cur, "update public.material m set volume_matriz_id = v.vm from (values %s) v(id, vm) where m.id = v.id", ligar)
    if a.simular:
        conn.rollback(); print("Simulação: nada foi gravado.")
    else:
        conn.commit()
    total = len(ligar) + len(peso_difere) + len(sem_par) + len(nao_lido)
    print(f"Volumes dos controles: {total} · ligados à matriz (nome e peso conferem): {len(ligar)} · nome casa mas peso difere: "
          f"{len(peso_difere)} · nome sem par na matriz: {len(sem_par)} · nome fora do padrão (k/N): {len(nao_lido)}")
    for titulo, lista in (("peso difere", peso_difere), ("sem par", sem_par), ("fora do padrão", nao_lido)):
        if lista:
            print(f"   {titulo} (ex.):", " | ".join(lista[:12]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

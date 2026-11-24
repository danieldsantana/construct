"""Importa um controle de estruturas no layout do T4 (ENTRADA com rótulos na coluna E e dados a partir
da F) e CONFERE o resultado contra a própria planilha antes de gravar.

Uso (na raiz do projeto):
    python scripts/importar/controles.py --simular          # lê e confere a leitura, sem gravar
    python scripts/importar/controles.py                    # grava os dois controles do T4

O que é gravado, por controle (linha + canteiro):
    material     um por linha de item da ENTRADA (seção + descrição); parte e peso vêm da VOLUMES RECEBIDOS
    previsto     coluna PREVISTO da ENTRADA
    nota_fiscal  cabeçalho de cada coluna com NF numérica
    movimento    uma por coluna da ENTRADA com data de recebimento (NF ou TRANSFERÊNCIA), com seus itens

Conferência (dentro da mesma transação; se qualquer item divergir, nada é gravado):
    1. por item: previsto e recebido no banco = colunas PREVISTO e RECEBIDO da ENTRADA
    2. nº de movimentos = nº de colunas com data
    3. peso: soma(recebido × peso unitário) = soma da coluna PESO de “RECEBIDO” da VOLUMES RECEBIDOS
Reimportar substitui o que veio daquele arquivo (os movimentos levam a origem 'controle:<arquivo>#<coluna>').
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter
from psycopg2.extras import execute_values

sys.path.insert(0, Path(__file__).parent.as_posix())
from comum import DADOS, conectar, sem_acento  # noqa: E402

CONTROLES = [
    # arquivo (relativo a "Dados criação/"), linha, canteiro. Layout com rótulos da ENTRADA na coluna E.
    ("01 - Controle de estruturas T4/1 - Controle de estruturas - Juazeiro.xlsx", "T4", "Juazeiro"),
    ("01 - Controle de estruturas T4/2 - Controle de estruturas - Laje dos Negros.xlsx", "T4", "Laje dos Negros"),
    ("02 - Estruturas T3/4 - Controle de estruturas - Umburanas - Rev.01.xlsx", "T3", "Umburanas"),
    ("02 - Estruturas T3/5 - Controle de estruturas - Laje dos Negros - Rev.01.xlsx", "T3", "Laje dos Negros"),
]
TIPO_RE = re.compile(r"\b(C4[A-Z0-9]+|BCTV)\b")
TOL = 1e-6


def data(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None


def numero(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def ler_controle(arq: Path):
    wb = openpyxl.load_workbook(arq, read_only=True, data_only=True)
    rows = [list(r) for r in wb["ENTRADA"].iter_rows(values_only=True)]
    largura = max(len(r) for r in rows)
    for r in rows:
        r.extend([None] * (largura - len(r)))
    # cabeçalho localizado pelos rótulos da coluna E (o T4 tem a linha "Ordem de Fabricação", o T3 não)
    h = next(i for i, r in enumerate(rows) if str(r[0] or "").strip().upper().startswith("DESCRI"))
    rot = {}
    for i in range(h):
        lab = sem_acento(rows[i][4] or "")
        for chave, padrao in (("data", "DATA DE RECEB"), ("forn", "FORNECEDOR"), ("nf", "NOTA FISCAL"), ("emissao", "DATA DE EMISS"),
                              ("romaneio", "ROMANEIO"), ("valor", "VALOR"), ("peso", "PESO"), ("of", "ORDEM DE FAB")):
            if lab.startswith(padrao):
                rot[chave] = i
    if "data" not in rot or "nf" not in rot:
        raise SystemExit(f"{arq.name}: não achei as linhas 'Data de Recebimento' e 'Nota Fiscal' na coluna E da ENTRADA")
    cel = lambda chave, j: rows[rot[chave]][j] if chave in rot else None  # noqa: E731
    # colunas somadas pela fórmula RECEBIDO: =SUMIF($E$1:$xx$1,"<>"&"", E:xx) -> toda coluna a partir de E com linha 1 preenchida
    cols = [j for j in range(4, largura) if rows[0][j] not in (None, "")]
    colunas = []
    for j in cols:
        if j == 4:  # coluna E: rótulo "Data de Recebimento:" (entra na soma, mas não é um recebimento)
            continue
        bruto = cel("nf", j)
        bruto = str(int(bruto)) if isinstance(bruto, (int, float)) else (str(bruto).strip() if bruto is not None else "")
        m = re.match(r"^(\d+)", bruto)
        of = str(cel("of", j)).strip() if cel("of", j) else None
        mo = re.search(r"(\d+)", of or "")
        colunas.append({
            "j": j, "letra": get_column_letter(j + 1), "data": data(rows[0][j]), "fornecedor": cel("forn", j),
            "nf": m.group(1) if m else None, "rotulo": bruto, "emissao": data(cel("emissao", j)),
            "romaneio": None if cel("romaneio", j) is None else str(cel("romaneio", j)).strip(), "valor": numero(cel("valor", j)),
            "peso": numero(cel("peso", j)), "of": of, "of_num": int(mo.group(1)) if mo else None,
        })
    itens, secao = [], None
    col_e_usada = []
    for i, r in enumerate(rows[h + 1:], start=h + 2):
        desc = r[0]
        if desc in (None, ""):
            continue
        if r[1] in (None, ""):
            secao = " ".join(str(desc).split())
            continue
        qt = {c["j"]: numero(r[c["j"]]) for c in colunas if numero(r[c["j"]])}
        if numero(r[4]):
            col_e_usada.append((i, r[4]))
        itens.append({"linha": i, "secao": secao, "desc": " ".join(str(desc).split()), "un": str(r[1]).strip(),
                      "prev": numero(r[2]) or 0.0, "rec": numero(r[3]) or 0.0, "qt": qt})
    # colunas preenchidas na linha 1 sem data (ex.: marcador de fim '|'): ignoradas se vazias; se tiverem
    # quantidade, é algo fora do padrão e a importação para.
    sem_data = [c for c in colunas if c["data"] is None]
    for c in sem_data:
        usadas = [it["linha"] for it in itens if c["j"] in it["qt"]]
        if usadas:
            raise SystemExit(f"{arq.name}: coluna {c['letra']} sem data de recebimento tem quantidades (linhas {usadas[:5]}) — revisar")
    colunas = [c for c in colunas if c["data"] is not None]
    # VOLUMES RECEBIDOS: parte e peso unitário por descrição; e o total da coluna PESO recebido
    vol, peso_total = {}, 0.0
    for r in wb["VOLUMES RECEBIDOS"].iter_rows(min_row=4, values_only=True):
        if not r[1] or numero(r[3]) is None or (isinstance(r[0], str) and r[0].upper().startswith("ESTRUTURA")):
            continue
        # coluna I (CONJUNTO COMPLETO): valor calculado pelo controle, só na 1ª linha de cada parte
        vol[" ".join(str(r[1]).split())] = {"parte": r[2], "pu": numero(r[4]), "cc": numero(r[8]) if len(r) > 8 else None}
        peso_total += numero(r[7]) or 0.0
    wb.close()
    return colunas, itens, vol, peso_total, col_e_usada


def importar(cur, arq, linha, canteiro, tipo_id):
    colunas, itens, vol, peso_total, col_e = ler_controle(DADOS / arq)
    arq = Path(arq).name  # a origem gravada usa só o nome do arquivo
    if col_e:
        print(f"   atenção: {len(col_e)} quantidade(s) na coluna E (rótulos) da ENTRADA, sem NF nem data — importadas como ajuste: "
              + ", ".join(f"linha {i} = {q:g}" for i, q in col_e))
    cur.execute("select id from public.linha where sigla = %s", (linha,))
    linha_id = cur.fetchone()[0]
    cur.execute("select id from public.canteiro where nome = %s", (canteiro,))
    canteiro_id = cur.fetchone()[0]
    origem_base = f"controle:{arq}"

    # gravação em lotes (poucas idas ao servidor)
    linhas_mat = []
    for it in itens:
        v = vol.get(it["desc"], {})
        t = TIPO_RE.search(it["secao"] or "") or TIPO_RE.search(it["desc"])
        linhas_mat.append((it["secao"], it["desc"], tipo_id.get(t.group(1)) if t else None, v.get("parte"), it["un"], v.get("pu"), it["linha"]))
    res = execute_values(cur,
        """insert into public.material (secao, descricao, tipo_torre_id, parte, unidade, peso_unit, ordem) values %s
           on conflict (secao, descricao) do update set tipo_torre_id = excluded.tipo_torre_id,
             parte = coalesce(excluded.parte, public.material.parte), unidade = excluded.unidade,
             peso_unit = coalesce(public.material.peso_unit, excluded.peso_unit)
           returning secao, descricao, id, peso_unit""", linhas_mat, page_size=1000, fetch=True)
    mat_id = {(r[0], r[1]): r[2] for r in res}
    pu_banco = {(r[0], r[1]): r[3] for r in res}
    for it in itens:
        pu = vol.get(it["desc"], {}).get("pu"); pb = pu_banco[(it["secao"], it["desc"])]
        if pu is not None and pb is not None and abs(float(pb) - pu) > 1e-4:
            print(f"   aviso: peso de '{it['desc']}' difere entre controles (banco {pb} × planilha {pu}); mantido o do banco")

    cur.execute("delete from public.previsto where linha_id = %s and canteiro_id = %s", (linha_id, canteiro_id))
    execute_values(cur, "insert into public.previsto (linha_id, canteiro_id, material_id, quantidade, fonte) values %s",
                   [(linha_id, canteiro_id, mat_id[(it["secao"], it["desc"])], it["prev"], f"{origem_base} · ENTRADA col. C linha {it['linha']}")
                    for it in itens if it["prev"]], page_size=1000)

    cur.execute("delete from public.conjunto_controle where linha_id = %s and canteiro_id = %s", (linha_id, canteiro_id))
    execute_values(cur, "insert into public.conjunto_controle (linha_id, canteiro_id, material_id, quantidade, fonte) values %s",
                   [(linha_id, canteiro_id, mat_id[(it["secao"], it["desc"])], vol[it["desc"]]["cc"], f"{origem_base} · VOLUMES RECEBIDOS col. I")
                    for it in itens if it["desc"] in vol and vol[it["desc"]]["cc"] is not None], page_size=1000)

    cur.execute("delete from public.movimento where origem like %s", (origem_base + "#%",))
    nfs = {}
    for c in colunas:  # uma linha por NF (a primeira coluna em que ela aparece)
        if c["nf"] and c["nf"] not in nfs:
            nfs[c["nf"]] = (c["nf"], c["emissao"], c["fornecedor"], c["of"], c["of_num"], c["romaneio"], c["valor"], c["peso"],
                            linha_id, canteiro_id, "confirmada", c["data"], f"{origem_base}#{c['letra']}")
    nf_id = {}
    if nfs:
        res = execute_values(cur,
            """insert into public.nota_fiscal (numero, emissao, fornecedor, of_texto, of_numero, romaneio, valor, peso,
                 linha_id, canteiro_id, situacao, recebida_em, origem) values %s
               on conflict (numero) do update set
                 emissao = coalesce(public.nota_fiscal.emissao, excluded.emissao),
                 fornecedor = coalesce(public.nota_fiscal.fornecedor, excluded.fornecedor),
                 of_texto = coalesce(public.nota_fiscal.of_texto, excluded.of_texto),
                 of_numero = coalesce(public.nota_fiscal.of_numero, excluded.of_numero),
                 romaneio = coalesce(public.nota_fiscal.romaneio, excluded.romaneio),
                 valor = coalesce(public.nota_fiscal.valor, excluded.valor),
                 peso = coalesce(public.nota_fiscal.peso, excluded.peso),
                 situacao = 'confirmada',
                 recebida_em = least(public.nota_fiscal.recebida_em, excluded.recebida_em)
               returning numero, id""", list(nfs.values()), template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::public.situacao_nf,%s,%s)",
            page_size=1000, fetch=True)
        nf_id = dict(res)
    linhas_mov = []
    for c in colunas:
        tipo = "recebimento" if c["nf"] else "transferencia"
        doc = None if c["nf"] else " ".join(x for x in (c["rotulo"], c["romaneio"]) if x)
        linhas_mov.append((tipo, c["data"], linha_id, canteiro_id, nf_id.get(c["nf"]), doc, f"{origem_base}#{c['letra']}"))
    res = execute_values(cur,
        """insert into public.movimento (tipo, data, linha_id, canteiro_id, nota_fiscal_id, documento, origem) values %s
           returning origem, id""", linhas_mov, template="(%s::public.tipo_movimento,%s,%s,%s,%s,%s,%s)", page_size=1000, fetch=True)
    mov_id = dict(res)
    itens_mov = [(mov_id[f"{origem_base}#{c['letra']}"], mat_id[(it["secao"], it["desc"])], it["qt"][c["j"]])
                 for c in colunas for it in itens if it["qt"].get(c["j"])]
    execute_values(cur, "insert into public.movimento_item (movimento_id, material_id, quantidade) values %s", itens_mov, page_size=2000)
    if col_e:  # a fórmula RECEBIDO soma a coluna E: o controle conta essas quantidades; aqui ficam visíveis como ajuste
        cur.execute("""insert into public.movimento (tipo, data, linha_id, canteiro_id, documento, origem, observacao)
                       values ('ajuste', null, %s, %s, %s, %s, %s) returning id""",
                    (linha_id, canteiro_id, "Quantidade na coluna E da ENTRADA (sem NF nem data)", f"{origem_base}#E",
                     "Conferir na planilha a qual recebimento pertence."))
        aj = cur.fetchone()[0]
        por_linha = {it["linha"]: it for it in itens}
        execute_values(cur, "insert into public.movimento_item (movimento_id, material_id, quantidade) values %s",
                       [(aj, mat_id[(por_linha[i]["secao"], por_linha[i]["desc"])], q) for i, q in col_e])

    # ---------- conferência contra a planilha ----------
    cur.execute("""select secao, descricao, previsto, recebido, peso_unit from public.saldo_material
                   where linha_id = %s and canteiro_id = %s""", (linha_id, canteiro_id))
    banco = {(r[0], r[1]): r for r in cur.fetchall()}
    difs = []
    for it in itens:
        b = banco.get((it["secao"], it["desc"]))
        bp, br = (float(b[2]), float(b[3])) if b else (0.0, 0.0)
        if abs(bp - it["prev"]) > TOL or abs(br - it["rec"]) > TOL:
            difs.append(f"linha {it['linha']} {it['desc']}: previsto {bp} × {it['prev']} · recebido {br} × {it['rec']}")
    cur.execute("select count(*) from public.movimento where origem like %s", (origem_base + "#%",))
    n_mov = cur.fetchone()[0]
    esperado = len(colunas) + (1 if col_e else 0)  # + o ajuste da coluna E, quando houver
    if n_mov != esperado:
        difs.append(f"movimentos {n_mov} × esperado {esperado} (colunas {len(colunas)})")
    peso_banco = sum(float(b[3]) * float(b[4]) for b in banco.values() if b[4] is not None and (b[0], b[1]) and
                     any(it["desc"] == b[1] for it in itens if it["desc"] in vol))
    if abs(peso_banco - peso_total) > 0.5:
        difs.append(f"peso recebido {peso_banco:.1f} kg × VOLUMES RECEBIDOS {peso_total:.1f} kg")
    return {"arq": arq, "colunas": len(colunas), "nfs": sum(1 for c in colunas if c["nf"]), "itens": len(itens),
            "previstos": sum(1 for it in itens if it["prev"]), "lancamentos": sum(len(it["qt"]) for it in itens),
            "peso": peso_total, "difs": difs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    if a.simular:
        for arq, linha, canteiro in CONTROLES:
            colunas, itens, vol, peso, col_e = ler_controle(DADOS / arq)
            soma_ok = sum(1 for it in itens if abs(sum(it["qt"].values()) - it["rec"]) <= TOL)
            print(f"{linha} · {canteiro}: {len(colunas)} colunas ({sum(1 for c in colunas if c['nf'])} NFs), {len(itens)} itens, "
                  f"{len(vol)} volumes com peso · soma das colunas = RECEBIDO em {soma_ok}/{len(itens)} itens"
                  + (f" · coluna E com valores: {len(col_e)}" if col_e else ""))
        print("Simulação: nada foi gravado.")
        return 0
    conn = conectar()
    ok = True
    for arq, linha, canteiro in CONTROLES:  # uma transação por controle: só grava o que confere
        with conn.cursor() as cur:
            cur.execute("select codigo, id from public.tipo_torre")
            tipo_id = dict(cur.fetchall())
            r = importar(cur, arq, linha, canteiro, tipo_id)
        estado = "CONFERE → gravado" if not r["difs"] else f"DIVERGE ({len(r['difs'])}) → NÃO gravado"
        print(f"{linha} · {canteiro}: {r['colunas']} colunas ({r['nfs']} NFs) · {r['itens']} itens · "
              f"{r['previstos']} previstos · {r['lancamentos']} lançamentos · peso {r['peso'] / 1000:.1f} t → {estado}")
        for d in r["difs"][:15]:
            print("   ", d)
        if r["difs"]:
            conn.rollback(); ok = False
        else:
            conn.commit()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

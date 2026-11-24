"""Importa os controles de estruturas (Excel) e CONFERE o resultado contra a própria planilha antes de gravar.

Dois layouts, detectados pelo cabeçalho DESCRIÇÃO da ENTRADA (e iguais no resto, só deslocados):
    T4 e T3 do usuário: itens em A–D, rótulos na coluna E, recebimentos a partir da F, datas na linha 1
    T3 do outro analista (Barra, Itajubaquara, Central): tudo uma coluna e uma linha adiante (itens em B–E,
    rótulos na F, recebimentos a partir da G, datas na linha 2, OF na própria linha do cabeçalho)

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
from comum import DADOS, conectar, numero_of, sem_acento  # noqa: E402

CONTROLES = [
    # arquivo (relativo a "Dados criação/"), linha, canteiro
    ("01 - Controle de estruturas T4/1 - Controle de estruturas - Juazeiro.xlsx", "T4", "Juazeiro"),
    ("01 - Controle de estruturas T4/2 - Controle de estruturas - Laje dos Negros.xlsx", "T4", "Laje dos Negros"),
    ("02 - Estruturas T3/4 - Controle de estruturas - Umburanas - Rev.01.xlsx", "T3", "Umburanas"),
    ("02 - Estruturas T3/5 - Controle de estruturas - Laje dos Negros - Rev.01.xlsx", "T3", "Laje dos Negros"),
    # layout deslocado (outro analista)
    ("02 - Estruturas T3/1 - Controle de estruturas - Barra - Rev.01.xlsx", "T3", "Barra"),
    ("02 - Estruturas T3/2 - Controle de estruturas - Itajubaquara - Rev.01.xlsx", "T3", "Itajubaquara"),
    ("02 - Estruturas T3/3 - Controle de estruturas - Central - Rev.01.xlsx", "T3", "Central"),
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
    # cabeçalho DESCRIÇÃO na coluna A (d = 0) ou B (d = 1, layout deslocado); rótulos na coluna 4 + d
    h, d = next((i, k) for i, r in enumerate(rows) for k in (0, 1) if str(r[k] or "").strip().upper().startswith("DESCRI"))
    rot = {}
    for i in range(h + 1):  # a linha do cabeçalho também: no layout deslocado ela traz "OF's →→→"
        lab = sem_acento(rows[i][4 + d] or "")
        for chave, padrao in (("data", "DATA DE RECEB"), ("forn", "FORNECEDOR"), ("nf", "NOTA FISCAL"), ("emissao", "DATA DE EMISS"),
                              ("romaneio", "ROMANEIO"), ("valor", "VALOR"), ("peso", "PESO"), ("of", "ORDEM DE FAB"), ("of", "OF'S")):
            if lab.startswith(padrao):
                rot[chave] = i
    if "data" not in rot or "nf" not in rot:
        raise SystemExit(f"{arq.name}: não achei as linhas 'Data de Recebimento' e 'Nota Fiscal' na coluna de rótulos da ENTRADA")
    cel = lambda chave, j: rows[rot[chave]][j] if chave in rot else None  # noqa: E731
    # colunas somadas pela fórmula RECEBIDO: =SUMIF($E$1:$xx$1,"<>"&"", E:xx) (deslocado: $F$2, F:xx)
    # -> toda coluna a partir da de rótulos com a linha de datas preenchida
    ld, cr = rot["data"], 4 + d
    cols = [j for j in range(cr, largura) if rows[ld][j] not in (None, "")]
    colunas = []
    for j in cols:
        if j == cr:  # coluna de rótulos ("Data de Recebimento:"): entra na soma, mas não é um recebimento
            continue
        bruto = cel("nf", j)
        bruto = str(int(bruto)) if isinstance(bruto, (int, float)) else (str(bruto).strip() if bruto is not None else "")
        m = re.match(r"^(\d+)", bruto)
        of = str(cel("of", j)).strip() if cel("of", j) else None
        colunas.append({
            "j": j, "letra": get_column_letter(j + 1), "data": data(rows[ld][j]), "fornecedor": cel("forn", j),
            "nf": m.group(1) if m else None, "rotulo": bruto, "emissao": data(cel("emissao", j)),
            "romaneio": None if cel("romaneio", j) is None else str(cel("romaneio", j)).strip(), "valor": numero(cel("valor", j)),
            "peso": numero(cel("peso", j)), "of": of, "of_num": numero_of(of),
        })
    itens, secao = [], None
    col_e_usada = []
    for i, r in enumerate(rows[h + 1:], start=h + 2):
        desc = r[d]
        if desc in (None, ""):
            continue
        if r[1 + d] in (None, ""):
            secao = " ".join(str(desc).split())
            continue
        qt = {c["j"]: numero(r[c["j"]]) for c in colunas if numero(r[c["j"]])}
        if numero(r[cr]):
            col_e_usada.append((i, r[cr]))
        itens.append({"linha": i, "secao": secao, "desc": " ".join(str(desc).split()), "un": str(r[1 + d]).strip(),
                      "prev": numero(r[2 + d]) or 0.0, "rec": numero(r[3 + d]) or 0.0, "qt": qt})
    # colunas preenchidas na linha 1 sem data (ex.: marcador de fim '|'): ignoradas se vazias; se tiverem
    # quantidade, é algo fora do padrão e a importação para.
    sem_data = [c for c in colunas if c["data"] is None]
    for c in sem_data:
        usadas = [it["linha"] for it in itens if c["j"] in it["qt"]]
        if usadas:
            raise SystemExit(f"{arq.name}: coluna {c['letra']} sem data de recebimento tem quantidades (linhas {usadas[:5]}) — revisar")
    colunas = [c for c in colunas if c["data"] is not None]
    # VOLUMES RECEBIDOS: parte e peso unitário por descrição; e o total da coluna PESO recebido
    linhas_vol = []
    for nlin, r in enumerate(wb["VOLUMES RECEBIDOS"].iter_rows(min_row=4, values_only=True), start=4):
        r = list(r) + [None] * 12
        if not r[1 + d] or numero(r[3 + d]) is None or (isinstance(r[d], str) and r[d].upper().startswith("ESTRUTURA")):
            continue
        # coluna I (J no deslocado), CONJUNTO COMPLETO: valor calculado pelo controle, só na 1ª linha de cada parte
        linhas_vol.append({"desc": " ".join(str(r[1 + d]).split()), "parte": r[2 + d], "pu": numero(r[4 + d]),
                           "cc": numero(r[8 + d]), "peso_rec": numero(r[7 + d]) or 0.0, "lin": nlin})
    wb.close()
    renomeados = renomear_repetidos(arq, itens, linhas_vol)
    vol = {v["desc"]: v for v in linhas_vol}
    peso_total = sum(v["peso_rec"] for v in linhas_vol)
    correcao = 0.0
    if renomeados:
        # a VOLUMES busca o recebido pelo nome (VLOOKUP): com nomes repetidos, todas as posições levam o recebido da 1ª.
        # O peso conferido passa a usar o recebido de cada linha da ENTRADA; a diferença é informada.
        rec = {it["desc"]: it["rec"] for it in itens}
        for v in linhas_vol:
            if v["desc"] in renomeados and v["pu"] is not None:
                certo = rec.get(v["desc"], 0.0) * v["pu"]
                correcao += certo - v["peso_rec"]
                peso_total += certo - v["peso_rec"]
        # conjunto completo dessas partes (ex. 'C4EP - TRONCO SUPERIOR') está errado pelo mesmo motivo. Corrigido com a
        # MESMA fórmula do controle (=SMALL(<linhas do grupo>,1)) aplicada ao recebido certo de cada linha da ENTRADA;
        # se a fórmula da planilha não for essa, o valor não é importado.
        base = lambda s: s.rsplit(" (", 1)[0]  # noqa: E731
        afetadas = {base(nome) for nome in renomeados}
        wf = openpyxl.load_workbook(arq, read_only=True)  # fórmulas
        col_cc = get_column_letter(9 + d)
        formulas = {}
        alvo = {v["lin"] for v in linhas_vol if base(v["desc"]) in afetadas and v["cc"] is not None}
        for nlin, (f,) in enumerate(wf["VOLUMES RECEBIDOS"].iter_rows(min_row=4, min_col=9 + d, max_col=9 + d, values_only=True), start=4):
            if nlin in alvo:
                formulas[nlin] = str(f or "")
        wf.close()
        for b in afetadas:
            grupo = [v for v in linhas_vol if base(v["desc"]) == b]
            planilha = grupo[0]["cc"]
            for v in grupo:
                v["cc"] = None
            cab = grupo[0]
            m = re.match(rf"^=SMALL\({get_column_letter(7 + d)}(\d+):{get_column_letter(7 + d)}(\d+),1\)$", formulas.get(cab["lin"], ""))
            if m and (int(m.group(1)), int(m.group(2))) == (grupo[0]["lin"], grupo[-1]["lin"]):
                cab["cc"] = min(rec.get(v["desc"], 0.0) for v in grupo)
                cab["cc_corrigido"] = True
                cab["cc_planilha"] = planilha
    return colunas, itens, vol, peso_total, col_e_usada, get_column_letter(cr + 1), renomeados, correcao


VOL_RE = re.compile(r"^(.*)\((\d+)/(\d+)\)$")
MATRIZ = DADOS / "Matrizes de embalagem e escalonamento" / "MATRIZES DE EMBALAGEM - PADRONIZADAS.xlsx"
_matriz = None


def pesos_matriz() -> dict[str, list[float]]:
    """Matriz de embalagem (aba BASE): peso de cada volume = soma do PESO TOTAL (col. P) das posições.
    Devolve {nome-base: [peso 1/N, …, peso N/N]} — ex. 'C4EP - TRONCO COMUM SUPERIOR': [5.566, 295.692, …]."""
    global _matriz
    if _matriz is None:
        from collections import defaultdict
        peso = defaultdict(float)
        wb = openpyxl.load_workbook(MATRIZ, read_only=True, data_only=True)
        for r in wb["BASE"].iter_rows(min_row=2, values_only=True):
            if r[3] and isinstance(r[15], (int, float)):
                peso[" ".join(str(r[3]).split())] += r[15]
        wb.close()
        grupos = defaultdict(dict)
        for nome, p in peso.items():
            m = VOL_RE.match(nome)
            if m:
                grupos[m.group(1).strip()][int(m.group(2))] = p
        _matriz = {b: [g[k] for k in sorted(g)] for b, g in grupos.items()}
    return _matriz


def renomear_repetidos(arq: Path, itens, linhas_vol) -> dict[str, str]:
    """Volumes escritos com o mesmo nome em todas as posições (ex. 6× 'C4EP - TRONCO SUPERIOR (1/6)').
    Só renomeia pela ordem quando há exatamente N repetições de '(1/N)', na ENTRADA e na VOLUMES; senão para.
    Devolve {nome novo: nome escrito na planilha}. O peso unitário de cada posição é conferido depois contra o banco."""
    from collections import defaultdict
    renomeados = {}
    for lista, chave in ((itens, lambda it: (it["secao"], it["desc"])), (linhas_vol, lambda v: v["desc"])):
        grupos = defaultdict(list)
        for x in lista:
            grupos[chave(x)].append(x)
        for k, g in grupos.items():
            if len(g) == 1:
                continue
            m = VOL_RE.match(g[0]["desc"])
            if not m or m.group(2) != "1" or int(m.group(3)) != len(g):
                raise SystemExit(f"{arq.name}: '{g[0]['desc']}' aparece {len(g)}× e não dá para separar pela posição — revisar")
            for pos, x in enumerate(g, start=1):
                novo = f"{m.group(1)}({pos}/{len(g)})"
                renomeados[novo] = x["desc"]
                x["desc"], x["escrito"] = novo, renomeados[novo]
    return renomeados


def importar(cur, arq, linha, canteiro, tipo_id):
    colunas, itens, vol, peso_total, col_e, letra_rot, renomeados, correcao = ler_controle(DADOS / arq)
    arq = Path(arq).name  # a origem gravada usa só o nome do arquivo
    if col_e:
        print(f"   atenção: {len(col_e)} quantidade(s) na coluna {letra_rot} (rótulos) da ENTRADA, sem NF nem data — importadas como ajuste: "
              + ", ".join(f"linha {i} = {q:g}" for i, q in col_e))
    difs_pre = []
    cc_corrigidos = [(v, v.get("cc_planilha") or 0) for v in vol.values() if v.get("cc_corrigido")]
    if renomeados:
        # renomeado pela posição: a sequência de pesos unitários (1/N … N/N) tem de ser a de um volume do mesmo tipo
        # na matriz de embalagem (fonte de verdade). Tipo fora da matriz: só aceito se nada foi recebido nessas linhas.
        matriz = pesos_matriz()
        rec = {it["desc"]: it["rec"] for it in itens}
        grupos = {}
        for novo in renomeados:
            grupos.setdefault(novo.rsplit(" (", 1)[0], []).append(novo)
        avisos = []
        for base, nomes in sorted(grupos.items()):
            nomes.sort(key=lambda s: int(VOL_RE.match(s).group(2)))
            seq = [vol.get(nm, {}).get("pu") for nm in nomes]
            tipo = base.split(" - ")[0]
            candidatos = [k for k, ws in matriz.items() if k.startswith(tipo + " - ") and len(ws) == len(seq)
                          and all(p is not None and abs(p - w) <= 0.05 for p, w in zip(seq, ws))]
            if len(candidatos) == 1:
                avisos.append(f"{base} = '{candidatos[0]}' da matriz")
            elif not any(k.startswith(tipo + " - ") for k in matriz) and not any(rec.get(nm) for nm in nomes):
                avisos.append(f"{base}: tipo fora da matriz, sem recebimento")
            else:
                difs_pre.append(f"'{base}' ({len(nomes)} linhas com o mesmo nome): pesos {seq} não identificam um volume da matriz {candidatos}")
        print(f"   atenção: {len(renomeados)} volumes com nome repetido na planilha, separados pela posição e conferidos pela "
              f"sequência de pesos da matriz: {'; '.join(avisos)}{' · DIVERGE' if difs_pre else ''}. "
              f"Peso recebido pela ENTRADA − pela VOLUMES: {correcao:+.1f} kg "
              f"(lá o VLOOKUP pega o recebido da 1ª linha); conjunto completo dessas partes recalculado com a fórmula do controle "
              f"(SMALL) sobre o recebido de cada linha: " + ", ".join(
                  f"{v['desc'].rsplit(' (', 1)[0]} = {v['cc']:g} (planilha mostra {pc:g})" for v, pc in cc_corrigidos))
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
                 -- OF do controle prevalece sobre a lida do PDF (nfs_pdf.py só preenche o que falta)
                 of_texto = coalesce(excluded.of_texto, public.nota_fiscal.of_texto),
                 of_numero = coalesce(excluded.of_numero, public.nota_fiscal.of_numero),
                 of_fonte = case when excluded.of_texto is not null then 'controle' else public.nota_fiscal.of_fonte end,
                 romaneio = coalesce(public.nota_fiscal.romaneio, excluded.romaneio),
                 valor = coalesce(public.nota_fiscal.valor, excluded.valor),
                 peso = coalesce(public.nota_fiscal.peso, excluded.peso),
                 -- NF que já veio do índice dos PDFs: a linha do índice vale; sem linha (ND), fica a do controle
                 linha_id = coalesce(public.nota_fiscal.linha_id, excluded.linha_id),
                 canteiro_id = coalesce(public.nota_fiscal.canteiro_id, excluded.canteiro_id),
                 situacao = 'confirmada',
                 recebida_em = least(public.nota_fiscal.recebida_em, excluded.recebida_em)
               returning numero, id""", list(nfs.values()), template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::public.situacao_nf,%s,%s)",
            page_size=1000, fetch=True)
        nf_id = dict(res)
        cur.execute("update public.nota_fiscal set of_fonte = 'controle' where of_texto is not null and of_fonte is null and id = any(%s)",
                    (list(nf_id.values()),))
    linhas_mov = []
    for c in colunas:
        tipo = "recebimento" if c["nf"] else "transferencia"
        # NF com complemento no rótulo (ex. "230254 - RNC") guarda o rótulo como documento
        doc = (c["rotulo"] if c["rotulo"] != c["nf"] else None) if c["nf"] else " ".join(x for x in (c["rotulo"], c["romaneio"]) if x)
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
                    (linha_id, canteiro_id, f"Quantidade na coluna {letra_rot} da ENTRADA (sem NF nem data)", f"{origem_base}#{letra_rot}",
                     "Conferir na planilha a qual recebimento pertence."))
        aj = cur.fetchone()[0]
        por_linha = {it["linha"]: it for it in itens}
        execute_values(cur, "insert into public.movimento_item (movimento_id, material_id, quantidade) values %s",
                       [(aj, mat_id[(por_linha[i]["secao"], por_linha[i]["desc"])], q) for i, q in col_e])

    # ---------- conferência contra a planilha ----------
    cur.execute("""select secao, descricao, previsto, recebido, peso_unit from public.saldo_material
                   where linha_id = %s and canteiro_id = %s""", (linha_id, canteiro_id))
    banco = {(r[0], r[1]): r for r in cur.fetchall()}
    difs = list(difs_pre)
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
    # recebido do banco × peso unitário DESTA planilha (o banco guarda o do 1º controle; há divergências entre arquivos)
    peso_banco = sum(float(banco[(it["secao"], it["desc"])][3]) * vol[it["desc"]]["pu"] for it in itens
                     if it["desc"] in vol and vol[it["desc"]]["pu"] is not None and (it["secao"], it["desc"]) in banco)
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
            colunas, itens, vol, peso, col_e, letra_rot, renomeados, _ = ler_controle(DADOS / arq)
            soma_ok = sum(1 for it in itens if abs(sum(it["qt"].values()) - it["rec"]) <= TOL)
            print(f"{linha} · {canteiro}: {len(colunas)} colunas ({sum(1 for c in colunas if c['nf'])} NFs), {len(itens)} itens, "
                  f"{len(vol)} volumes com peso · soma das colunas = RECEBIDO em {soma_ok}/{len(itens)} itens"
                  + (f" · coluna {letra_rot} com valores: {len(col_e)}" if col_e else "")
                  + (f" · {len(renomeados)} volumes com nome repetido (separados pela posição)" if renomeados else ""))
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

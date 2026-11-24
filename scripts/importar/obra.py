"""Importa a estrutura da obra: linhas, canteiros, tipos de torre, torres (LC) e faixas de canteiro.

Uso (na raiz do projeto):
    python scripts/importar/obra.py            # importa/atualiza
    python scripts/importar/obra.py --simular  # lê e confere, sem gravar

Fontes (em "Dados criação/"):
    LC/BR-LO14-71607-L-11-D1096-*.xlsx   LC do T4   (aba LC)
    LC/BR-LO14-71607-L-11-D1097-*.xlsx   LC do T3   (aba LC)
    OF e controles cliente/Distribuição de canteiros*.xlsx   faixas oficiais
Layout das planilhas: ver o mapa privado das fontes (§2 LC, §5.3 distribuição).
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter

import openpyxl

sys.path.insert(0, __import__("pathlib").Path(__file__).parent.as_posix())
from comum import DADOS, conectar, numero, numero_torre  # noqa: E402

LINHAS = [
    # sigla, código, nome, documento da LC, aba da distribuição
    ("T3", "CAFII-BRRII", "LT 500 kV Campo Formoso II – Barra II C1", "BR-LO14-71607-L-11-D1097", "CAFII-BRRII"),
    ("T4", "JZTIII-CAFII", "LT 500 kV Juazeiro III – Campo Formoso II C1", "BR-LO14-71607-L-11-D1096", "JZTIII-CAFII"),
]
ESTAIADAS = {"C4EL", "C4EP", "C4EPR"}
CANTEIROS = {  # nome na distribuição (sem " - BA") -> nome na ferramenta
    "JUAZEIRO": "Juazeiro",
    "LAJE DOS NEGROS": "Laje dos Negros",
    "LAJES DOS NEGROS": "Laje dos Negros",
    "UMBURANAS": "Umburanas",
    "CENTRAL": "Central",
    "ITAJUBAQUARA": "Itajubaquara",
    "BARRA": "Barra",
}
# Colunas da aba LC (iguais nas duas LCs a partir de K)
COL = {"numero": 0, "tipo": 17, "altura": 18, "extensao": 20,
       "perna_a": 21, "perna_b": 22, "perna_c": 23, "perna_d": 24, "perna_ref": 25}


def arquivo_lc(documento: str):
    achados = sorted((DADOS / "LC").glob(f"{documento}-*.xlsx"))
    if not achados:
        sys.exit(f"LC não encontrada: {documento}-*.xlsx")
    arq = achados[-1]
    revisao = arq.stem.split("-")[-1]
    return arq, revisao


def ler_lc(arq):
    ws = openpyxl.load_workbook(arq, read_only=True, data_only=True)["LC"]
    torres = []
    for row in ws.iter_rows(min_row=9, values_only=True):
        num = numero_torre(row[COL["numero"]])
        tipo = (str(row[COL["tipo"]] or "").strip().upper())
        if not num or not tipo or tipo == "PORT":
            continue
        ref = str(row[COL["perna_ref"]] or "").strip().upper()
        torres.append({
            "numero": num,
            "tipo": tipo,
            "altura_util": numero(row[COL["altura"]]),
            "extensao": numero(row[COL["extensao"]]),
            "perna_a": numero(row[COL["perna_a"]]),
            "perna_b": numero(row[COL["perna_b"]]),
            "perna_c": numero(row[COL["perna_c"]]),
            "perna_d": numero(row[COL["perna_d"]]),
            "perna_referencia": ref if ref in ("A", "B", "C", "D") else None,
        })
    return torres


def ler_faixas():
    arqs = sorted((DADOS / "OF e controles cliente").glob("Distribuição de canteiros*.xlsx"))
    if not arqs:
        sys.exit("Arquivo de distribuição de canteiros não encontrado")
    wb = openpyxl.load_workbook(arqs[-1], read_only=True, data_only=True)
    faixas = {}  # aba -> [(canteiro, inicial, final)]
    for ws in wb.worksheets:
        linhas = [r for r in ws.iter_rows(min_row=2, values_only=True) if r and r[1] and r[2]]
        pares = []
        for i in range(0, len(linhas) - 1, 2):
            c0 = str(linhas[i][1]).replace(" - BA", "").strip().upper()
            c1 = str(linhas[i + 1][1]).replace(" - BA", "").strip().upper()
            if c0 != c1:
                sys.exit(f"Distribuição fora do padrão (início/fim) na aba {ws.title}: {c0} × {c1}")
            if c0 not in CANTEIROS:
                sys.exit(f"Canteiro desconhecido na distribuição: {c0}")
            pares.append((CANTEIROS[c0], numero_torre(linhas[i][2]), numero_torre(linhas[i + 1][2])))
        faixas[ws.title] = pares
    return faixas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()

    faixas = ler_faixas()
    dados = []
    for sigla, codigo, nome, doc, aba in LINHAS:
        arq, rev = arquivo_lc(doc)
        torres = ler_lc(arq)
        tipos = Counter(t["tipo"] for t in torres)
        print(f"{sigla} {codigo}: {arq.name} (rev {rev}) — {len(torres)} torres; "
              + ", ".join(f"{k} {v}" for k, v in sorted(tipos.items())))
        sem_altura = [t["numero"] for t in torres if t["altura_util"] is None]
        if sem_altura:
            sys.exit(f"  torres sem altura útil: {sem_altura[:10]}")
        for c, ini, fim in faixas.get(aba, []):
            print(f"   faixa {c:<16} {ini} → {fim}")
        dados.append((sigla, codigo, nome, doc, rev, torres, faixas.get(aba, [])))

    if a.simular:
        print("\nSimulação: nada foi gravado.")
        return 0

    conn = conectar()
    with conn, conn.cursor() as cur:
        for canteiro in sorted(set(CANTEIROS.values())):
            cur.execute("insert into public.canteiro (nome) values (%s) on conflict (nome) do nothing", (canteiro,))
        todos_tipos = sorted({t["tipo"] for *_, torres, _f in dados for t in torres})
        for tipo in todos_tipos:
            cur.execute(
                "insert into public.tipo_torre (codigo, categoria) values (%s, %s) "
                "on conflict (codigo) do update set categoria = excluded.categoria",
                (tipo, "estaiada" if tipo in ESTAIADAS else "autoportante"))
        cur.execute("select codigo, id from public.tipo_torre")
        tipo_id = dict(cur.fetchall())
        cur.execute("select nome, id from public.canteiro")
        canteiro_id = dict(cur.fetchall())

        for sigla, codigo, nome, doc, rev, torres, fx in dados:
            cur.execute(
                "insert into public.linha (sigla, codigo, nome, lc_documento, lc_revisao) values (%s,%s,%s,%s,%s) "
                "on conflict (sigla) do update set codigo=excluded.codigo, nome=excluded.nome, "
                "lc_documento=excluded.lc_documento, lc_revisao=excluded.lc_revisao returning id",
                (sigla, codigo, nome, doc, rev))
            linha_id = cur.fetchone()[0]
            # reordena com folga para não colidir com a restrição única de ordem durante o upsert
            cur.execute("update public.torre set ordem = ordem + 100000 where linha_id = %s", (linha_id,))
            for ordem, t in enumerate(torres, start=1):
                cur.execute(
                    """insert into public.torre (linha_id, numero, ordem, tipo_torre_id, altura_util, extensao,
                         perna_a, perna_b, perna_c, perna_d, perna_referencia, lc_revisao)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       on conflict (linha_id, numero) do update set ordem=excluded.ordem,
                         tipo_torre_id=excluded.tipo_torre_id, altura_util=excluded.altura_util,
                         extensao=excluded.extensao, perna_a=excluded.perna_a, perna_b=excluded.perna_b,
                         perna_c=excluded.perna_c, perna_d=excluded.perna_d,
                         perna_referencia=excluded.perna_referencia, lc_revisao=excluded.lc_revisao""",
                    (linha_id, t["numero"], ordem, tipo_id[t["tipo"]], t["altura_util"], t["extensao"],
                     t["perna_a"], t["perna_b"], t["perna_c"], t["perna_d"], t["perna_referencia"], rev))
            cur.execute("select count(*) from public.torre where linha_id = %s and ordem > 100000", (linha_id,))
            sobras = cur.fetchone()[0]
            if sobras:
                print(f"  aviso: {sobras} torre(s) do banco não estão mais na LC {rev} (mantidas, marcadas no fim)")
            cur.execute("select numero, id from public.torre where linha_id = %s", (linha_id,))
            torre_id = dict(cur.fetchall())
            for c, ini, fim in fx:
                if ini not in torre_id or fim not in torre_id:
                    sys.exit(f"  faixa {c} {ini}→{fim}: torre não encontrada na LC")
                cur.execute(
                    """insert into public.faixa_canteiro (linha_id, canteiro_id, torre_inicial_id, torre_final_id)
                       values (%s,%s,%s,%s) on conflict (linha_id, canteiro_id) do update
                       set torre_inicial_id=excluded.torre_inicial_id, torre_final_id=excluded.torre_final_id""",
                    (linha_id, canteiro_id[c], torre_id[ini], torre_id[fim]))

        cur.execute("""select linha_sigla, coalesce(canteiro,'(sem canteiro)'), count(*)
                       from public.torre_detalhe group by 1,2 order by 1, min(ordem)""")
        print("\nGravado. Torres por canteiro:")
        for l, c, n in cur.fetchall():
            print(f"  {l}  {c:<16} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

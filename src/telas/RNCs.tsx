import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Titulo } from '../componentes/Titulo';
import { Gaveta } from '../componentes/Gaveta';
import { useEscopo } from '../lib/escopo';
import { data } from '../lib/formato';
import { rncTexto, sacTexto, useRncNF, type RncNF } from '../dados/rnc';
import { SITUACAO } from './Notas';

type Grupo = { chave: string; rnc: string | null; sacs: string[]; nfs: RncNF[]; destinos: string[]; ultima: string };

// RNCs = o que as NFs de reposição dizem (SAC e RNC do nome do PDF / campo OC). Uma RNC pode ter vários SACs
// e várias NFs; um SAC pode citar várias RNCs. Registro próprio (itens, situação) vem depois.
export function RNCs() {
  const dados = useRncNF();
  const { inclui, escopo } = useEscopo();
  const [params, setParams] = useSearchParams();
  const sel = params.get('rnc');
  const abrir = (k: string | null) => {
    const p = new URLSearchParams(params);
    if (k) p.set('rnc', k); else p.delete('rnc');
    setParams(p, { replace: true });
  };

  // NF de reposição costuma vir sem linha ("ND"): entra pelo canteiro, em qualquer linha
  const noEscopo = (x: RncNF) => {
    const c = x.local_entrega ?? '';  // local de entrega prevalece
    if (x.linha_local) return inclui(x.linha_local, c);
    return !escopo.canteiro ? inclui('T3', c) || inclui('T4', c) : c === escopo.canteiro;
  };

  const grupos = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const x of dados.dados.filter(noEscopo)) {
      // RNC agrupa; SAC sem RNC vira um grupo próprio pelo SAC
      const chave = x.rnc ? `r:${x.rnc}` : `s:${x.sac}`;
      const g = m.get(chave) ?? { chave, rnc: x.rnc, sacs: [], nfs: [], destinos: [], ultima: '' };
      if (x.sac && !g.sacs.includes(x.sac)) g.sacs.push(x.sac);
      if (!g.nfs.some((n) => n.nf_id === x.nf_id)) g.nfs.push(x);
      const d = x.destino ?? x.canteiro_recebimento;
      if (d && !g.destinos.includes(d)) g.destinos.push(d);
      if ((x.emissao ?? '') > g.ultima) g.ultima = x.emissao ?? '';
      m.set(chave, g);
    }
    const num = (g: Grupo) => Number((g.rnc ?? '').replace(/\D/g, '')) || 0;
    return [...m.values()].sort((a, b) => (a.rnc ? 0 : 1) - (b.rnc ? 0 : 1) || num(b) - num(a) || b.ultima.localeCompare(a.ultima));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.dados, inclui, escopo.canteiro]);

  if (dados.carregando) return <><Titulo texto="RNCs" /><p className="muted">Carregando…</p></>;
  if (dados.erro) return <><Titulo texto="RNCs" /><p className="warn">Não foi possível carregar: {dados.erro}</p></>;

  const comRnc = grupos.filter((g) => g.rnc);
  const semRnc = grupos.filter((g) => !g.rnc);
  const g = grupos.find((x) => x.chave === sel) ?? null;

  return (
    <>
      <Titulo texto="RNCs"><span className="num">{comRnc.length} RNCs · {semRnc.length} SACs sem RNC</span></Titulo>
      <div className="notes">
        Fonte: NFs de reposição (SAC e RNC do nome do PDF, iguais ao campo "OC:" do DANFE). Uma RNC pode ter vários SACs e várias NFs,
        e um SAC pode citar várias RNCs — a tabela mostra todos. A coluna "Lançadas" diz quantas dessas NFs aparecem num controle de
        estruturas (em geral os controles não lançam reposições). Situação da RNC (aberta, parcial, fechada) entra com o registro próprio.
      </div>
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="tramo-h"><b>RNCs</b><span className="muted">{comRnc.length}</span></div>
        <Tabela grupos={comRnc} sel={sel} abrir={abrir} todos={dados.dados} />
      </section>
      {semRnc.length > 0 && (
        <section className="panel">
          <div className="tramo-h"><b>SACS SEM RNC INFORMADA</b><span className="muted">{semRnc.length}</span></div>
          <Tabela grupos={semRnc} sel={sel} abrir={abrir} todos={dados.dados} />
        </section>
      )}
      <Ficha g={g} todos={dados.dados} aoFechar={() => abrir(null)} />
    </>
  );
}

export function Tabela({ grupos, sel, abrir, todos }: { grupos: Grupo[]; sel: string | null; abrir: (k: string) => void; todos: RncNF[] }) {
  if (!grupos.length) return <p className="muted" style={{ padding: 10 }}>Nada neste escopo.</p>;
  return (
    <div style={{ overflow: 'auto' }}>
      <table>
        <thead><tr><th>RNC</th><th>SACs</th><th className="r">NFs</th><th>NFs de reposição</th><th>Destino</th><th>Última NF</th><th className="r">Lançadas</th></tr></thead>
        <tbody>
          {grupos.map((g) => {
            const lancadas = g.nfs.filter((n) => n.situacao_exibida === 'confirmada' || n.situacao_exibida === 'em_conferencia').length;
            // SAC que também cita outras RNCs
            const outras = new Set(todos.filter((x) => x.sac && g.sacs.includes(x.sac) && x.rnc && x.rnc !== g.rnc).map((x) => x.rnc!));
            return (
              <tr key={g.chave} className="clk" onClick={() => abrir(g.chave)} style={g.chave === sel ? { background: 'var(--orange-tint)' } : undefined}>
                <td><b>{g.rnc ? rncTexto(g.rnc) : '—'}</b></td>
                <td>{g.sacs.map((s) => <span key={s} className="st info" style={{ marginRight: 4 }}>{sacTexto(s)}</span>)}
                  {outras.size > 0 && <span className="muted" style={{ fontSize: 12 }} title="O mesmo SAC também cita estas RNCs"> + {[...outras].map(rncTexto).join(', ')}</span>}</td>
                <td className="r num">{g.nfs.length}</td>
                <td className="num">{g.nfs.map((n) => n.numero).join(' · ')}</td>
                <td>{g.destinos.join(', ') || '—'}</td>
                <td className="num">{data(g.ultima)}</td>
                <td className="r num">{lancadas ? `${lancadas} de ${g.nfs.length}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Ficha({ g, todos, aoFechar }: { g: Grupo | null; todos: RncNF[]; aoFechar: () => void }) {
  // RNCs ligadas pelos mesmos SACs (muitos-para-muitos)
  const ligadas = g ? [...new Set(todos.filter((x) => x.sac && g.sacs.includes(x.sac) && x.rnc && x.rnc !== g.rnc).map((x) => x.rnc!))] : [];
  return (
    <Gaveta aberta={!!g} aoFechar={aoFechar} sub="RNC · controle paralelo (a partir das NFs)"
            titulo={g ? (g.rnc ? rncTexto(g.rnc) : `${sacTexto(g.sacs[0] ?? '')} sem RNC`) : ''}
            resumo={g ? [
              ['SACs', g.sacs.length], ['NFs de reposição', g.nfs.length],
              ['Destino', g.destinos.join(', ') || '—'], ['Última NF', data(g.ultima)],
            ] : undefined}>
      {g && (
        <>
          <section>
            <h3 className="dr-t">SACs</h3>
            <p style={{ margin: 0 }}>{g.sacs.map((s) => <span key={s} className="st info" style={{ marginRight: 6 }}>{sacTexto(s)}</span>)}</p>
            {ligadas.length > 0 && <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>Os mesmos SACs também citam: {ligadas.map(rncTexto).join(', ')}.</p>}
          </section>
          <section>
            <h3 className="dr-t">NFs de reposição</h3>
            <table>
              <thead><tr><th>NF</th><th>SAC</th><th>Emissão</th><th>Destino</th><th>Situação</th></tr></thead>
              <tbody>
                {[...g.nfs].sort((a, b) => (a.emissao ?? '').localeCompare(b.emissao ?? '')).map((n) => {
                  const s = SITUACAO[n.situacao_exibida];
                  return (
                    <tr key={n.nf_id}>
                      <td><b>{n.numero}</b></td><td>{n.sac ? sacTexto(n.sac) : '—'}</td><td className="num">{data(n.emissao)}</td>
                      <td>{n.destino ?? '—'}</td>
                      <td><span className={`st ${s[1]}`} title={s[2]}>{s[0]}</span>{n.canteiro_recebimento && <span className="muted num"> · {n.canteiro_recebimento} {data(n.recebida_em)}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <div className="callout">Itens da RNC (peças, torres), SAC aberto/fechado e baixa da reposição entram quando fizermos o registro próprio de RNC.</div>
        </>
      )}
    </Gaveta>
  );
}

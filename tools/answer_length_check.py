#!/usr/bin/env python3
"""Check whether the correct answer is biased toward being the longest choice.
Usage: python3 tools/answer_length_check.py QUIZ.html [QUIZ2.html ...] [--verbose]
Parses `const Q=[...];` (objects with q, c, a). T/F (2-choice) questions are skipped.
Targets: strictly-longest rate <= ~1/N (+5pt), mean correct len within 15% of mean distractor len."""
import json,re,sys,statistics as st
def load(p):
    t=open(p,encoding='utf-8').read();i=t.index('const Q=')+len('const Q=')
    return json.JSONDecoder().raw_decode(t[i:])[0]
def report(p,verbose=False):
    Q=load(p);mc=[(i,q) for i,q in enumerate(Q) if len(q['c'])>2]
    n=len(mc);sl=lt=sh=0;cl=[];dl=[];flags=[];N=st.mean(len(q['c']) for _,q in mc) if n else 4
    for i,q in mc:
        L=[len(c) for c in q['c']];a=q['a'];ca=L[a];oth=[x for j,x in enumerate(L) if j!=a]
        cl.append(ca);dl+=oth
        if ca>max(oth):sl+=1;flags.append((i+1,'strictly longest',ca,max(oth)))
        elif ca==max(oth):lt+=1;flags.append((i+1,'tied longest',ca,max(oth)))
        if ca<min(oth):sh+=1
    mc_,md=st.mean(cl),st.mean(dl);ratio=mc_/md
    lim=100/N+5;ok=100*sl/n<=lim and abs(ratio-1)<=0.15
    print(f"== {p}\n MC questions: {n} (of {len(Q)}; T/F skipped), avg choices {N:.1f}")
    print(f" correct strictly longest: {sl}/{n} = {100*sl/n:.0f}%  (target <= {lim:.0f}%)")
    print(f" correct longest or tied:  {sl+lt}/{n} = {100*(sl+lt)/n:.0f}%")
    print(f" correct shortest:         {sh}/{n} = {100*sh/n:.0f}%")
    print(f" mean correct len {mc_:.1f} vs distractor {md:.1f} (ratio {ratio:.2f}, target 0.85-1.15)")
    print(" RESULT:","PASS" if ok else "FAIL")
    for f in flags: print(f"  flag Q{f[0]}: {f[1]} ({f[2]} vs next {f[3]})")
    return ok
if __name__=='__main__':
    ps=[a for a in sys.argv[1:] if not a.startswith('--')]
    r=[report(p) for p in ps];sys.exit(0 if all(r) else 1)

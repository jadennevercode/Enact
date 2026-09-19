/* Standalone educational scenes. No product connections or credentials. */
(() => {
  'use strict';
  const scenes = window.GUIDE_SCENES;
  const chapters = window.GUIDE_CHAPTERS;
  const stages = window.GUIDE_STAGES;
  const frameDuration = 4500;
  document.documentElement.style.setProperty('--frame-duration', `${frameDuration}ms`);
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg>';
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'enact-aisdlc-guide-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* Storage is optional. */ }
  let page = 0;
  let frame = 0;
  let paused = media.matches || saved.paused === true;
  let timer;
  let deadline=0;
  let remaining=frameDuration;
  let toastTimer;
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({scene:scenes[page].id,paused})); } catch { /* Private or file browsers can disable storage. */ } };

  function text(x, y, value, cls='viz-label', anchor='middle') {
    return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${escape(value)}</text>`;
  }
  function line(d, on=false, extra='') { return `<path d="${d}" class="viz-line ${on?'on':''} ${extra}"/>`; }
  function flow(d, on=true) {
    if (!on) return line(d);
    const motion = media.matches ? '' : `<circle r="3" fill="#b8e577"><animateMotion dur="1.8s" repeatCount="1" fill="freeze" path="${d}"/></circle>`;
    return line(d,true,'draw') + motion;
  }
  function box(x,y,w,h,label,sub='',active=false) {
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="viz-card ${active?'active':''}"/>${text(x+w/2,y+h/2+(sub?-3:5),label)}${sub?text(x+w/2,y+h/2+18,sub,'viz-small'):''}</g>`;
  }
  function person(x,y,active=true) {
    return `<g stroke="${active?'#a5cb76':'#68846e'}" fill="none" stroke-width="1.5"><circle cx="${x}" cy="${y-12}" r="9"/><path d="M${x-17} ${y+17}v-5a17 17 0 0 1 34 0v5"/></g>`;
  }
  function documentIcon(x,y,active=true) {
    return `<g stroke="${active?'#b6d993':'#68846e'}" fill="none" stroke-width="1.5"><path d="M${x-13} ${y-20}h18l9 9v31h-27zM${x+5} ${y-20}v10h9M${x-6} ${y-3}h12M${x-6} ${y+4}h12M${x-6} ${y+11}h8"/></g>`;
  }
  function group(visible, content, current=false) { return `<g class="${visible?'active-group':'muted-group'} ${current?'current-group':''}">${content}</g>`; }
  function badge(x,y,label,active=true) { return `<rect x="${x}" y="${y}" width="${label.length*10+22}" height="23" fill="${active?'#86bc25':'#223d29'}" rx="1"/>${text(x+11,y+15,label,active?'badge-text':'viz-small','start')}`; }
  function check(x,y,active=true) {return `<circle cx="${x}" cy="${y}" r="10" fill="${active?'#86bc25':'#263f2c'}"/><path d="m${x-4} ${y} 3 3 5-6" fill="none" stroke="${active?'#092010':'#718d79'}" stroke-width="1.7"/>`;}
  // Pain and solution use matching node positions so the change stays legible.
  function broken(d,x,y) {
    return `<path d="${d}" class="pain-link"/><g class="pain-mark"><circle cx="${x}" cy="${y}" r="11" fill="#33291d" stroke="#d6aa6b"/>${text(x,y+4,'?','viz-small viz-warning')}</g>`;
  }
  function painGraphic(s) {
    let g='';
    switch(s.type) {
      case 'lifecycle': {
        const p=[[100,107],[300,72],[500,107],[500,292],[300,334],[100,292]];
        p.forEach(([x,y],i)=>{const n=p[(i+1)%6];g+=broken(`M${x} ${y}L${n[0]} ${n[1]}`,(x+n[0])/2,(y+n[1])/2);});
        p.forEach(([x,y],i)=>g+=box(x-66,y-29,132,58,['需求澄清','设计规范','开发实施','独立 QA','发布判断','运营反馈'][i]));
        g+=text(300,196,'各自产出，交接断裂','viz-big')+text(300,223,'局部加速，仍需连接整条旅程','viz-small');break;
      }
      case 'questions': {
        g+=box(183,25,234,64,'一项业务请求','关键决定尚未展开');
        ['识别规则？','共享边界？','不确定性？','推荐依据？','后续交接？','试点监控？'].forEach((v,i)=>{
          const x=i%2?320:45,y=133+Math.floor(i/2)*83;
          g+=line(`M300 89V${y+27}H${x+110}`,false,'viz-dashed')+box(x,y,235,55,v);
        });break;
      }
      case 'decisions': {
        g+=box(30,166,132,66,'未核实假设','与事实混在一起');
        g+=broken('M162 199H433',300,199)+box(433,166,135,66,'完整的 PRD','未经具名确认');
        g+=text(300,76,'文字完整，决定仍然缺席','viz-big')+person(300,300,false)+text(300,344,'谁确认这些业务规则？','viz-small');break;
      }
      case 'contract': {
        g+=box(155,40,290,154,'同一个业务决定','尚未形成共同执行规范');
        ['编码任务','测试判定','评审规则','发布门禁'].forEach((v,i)=>{const x=20+i*145;g+=broken(`M300 194V244H${x+62}V285`,x+62,265)+box(x,285,125,58,v);});
        g+=text(300,383,'各自解释要求，结果可能不一致','viz-small');break;
      }
      case 'context': {
        ['已批准行为？','相关代码','调用方契约缺失','无关仓库与数据','旧版工程规则'].forEach((v,i)=>g+=box(20,42+i*61,166,44,v));
        g+=broken('M186 195H377',294,195)+box(377,124,203,156,'混杂的上下文','缺少筛选 / 来源 / 版本');
        g+=text(300,380,'关键背景缺失，无关信息增加判断负担','viz-small');break;
      }
      case 'boundary': {
        g+=`<rect x="28" y="35" width="544" height="338" fill="#0d2016" stroke="#ab8447" stroke-dasharray="6 5"/>${text(50,62,'工具可访问 · 授权未说明','viz-mono','start')}`;
        g+=box(55,95,205,92,'本次实现范围','可以修改哪些文件？')+box(337,95,205,92,'调用方仓库','只读还是可写？');
        g+=box(55,238,205,77,'必要工具与测试','操作范围未明确')+box(337,238,205,77,'生产环境与凭据','是否允许访问？');
        g+=broken('M260 141H337',299,141)+broken('M260 276H337',299,276);
        g+=text(300,403,'方法论中的边界示意 · 实际控制需工程机制支撑','viz-mono');break;
      }
      case 'ledger': {
        g+=box(26,149,150,93,'实施已结束','只留一句“已完成”')+broken('M176 195H222',198,195);
        g+=`<rect x="222" y="43" width="352" height="326" fill="#0b1a12" stroke="#416347"/>${text(245,73,'EXECUTION RECORD · 缺失','viz-mono','start')}`;
        ['依据是什么？','来源和版本有效吗？','实际调用了什么？','改动在哪里？','哪些检查通过？','还有哪些异常？'].forEach((v,i)=>g+=text(245,115+i*41,v,'viz-small','start'));break;
      }
      case 'qa': {
        g+=box(205,26,190,55,'获批规范')+line('M270 81V113H155V149');
        g+=box(42,149,226,114,'Coding Agent','实现与自测基于同一理解')+box(332,149,226,114,'验证预期','从现有实现反向推导');
        g+=broken('M268 205H332',300,205)+text(300,309,'同一个错误假设，可能同时进入实现与验证','viz-small');
        g+=box(205,321,190,59,'独立质量证据？');break;
      }
      case 'quality': {
        const tiers=[['运行与业务旅程','尚未验证'],['关联系统','兼容性未知'],['组件实现','单元测试 / CI 通过']];
        tiers.forEach(([a,b],i)=>{const x=38+i*45,y=60+i*80,w=524-i*90,h=300-i*80;g+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${i===2?'#24442a':'#10261a'}" stroke="${i===2?'#86bc25':'#ab8447'}" ${i<2?'stroke-dasharray="5 5"':''}/>${text(x+18,y+27,a,'viz-label','start')}${text(x+18,y+49,b,'viz-small','start')}`;});
        g+=text(300,399,'局部通过，不能替代完整质量判断','viz-small');break;
      }
      case 'gate': {
        g+=box(28,165,135,70,'质量证据','报告已产生')+line('M163 200H232');
        g+=`<path d="m300 132 68 68-68 68-68-68z" fill="#33291d" stroke="#ab8447"/>${text(300,205,'去向不清')}`;
        ['可继续？','谁修复？','谁判断？'].forEach((v,i)=>{const y=52+i*126;g+=broken(`M368 200H405V${y+30}H440`,419,y+30)+box(440,y,135,62,v);});break;
      }
      case 'chain': {
        ['业务决定','执行规范','受控实现','独立 QA','生产准备'].forEach((v,i)=>{const x=18+i*117;g+=box(x,154,98,76,v,'独立材料');if(i<4)g+=broken(`M${x+98} 192h19`,x+108,192);g+=text(x+49,133,`0${i+1}`,'viz-mono');});
        g+=text(300,62,'材料齐了，依据还要自己拼','viz-big')+person(300,306,false)+text(300,351,'审查者重新追问版本、关系与风险','viz-small');break;
      }
      case 'release': {
        g+=box(30,77,225,253,'AI 建议 / 测试通过','尚不构成风险接受');
        g+=broken('M255 202H406',354,202)+person(354,136,false)+text(354,176,'责任人未确认','viz-small');
        ['发布？','暂缓？','拒绝？'].forEach((v,i)=>g+=box(406,69+i*107,155,64,v));
        g+=text(300,402,'质量证明、风险接受与实际部署需要分别成立','viz-small');break;
      }
      case 'operations': {
        g+=text(50,43,'运行观察 · 示意，无实测数值','viz-mono','start');
        ['契约错误','通知送达','旅程成功'].forEach((v,i)=>{const y=89+i*77;g+=text(32,y+13,v,'viz-small','start')+broken(`M123 ${y+27}H560`,341,y+27)+text(341,y+9,'实际结果尚未验证','viz-small');});
        g+=box(130,337,155,49,'恢复准备？')+box(328,337,210,49,'部署成功 ≠ 目标实现');break;
      }
      case 'learning': {
        const p=[[75,82,'运行事实'],[348,82,'零散经验'],[348,270,'尚未确认的改进'],[75,270,'下一轮交付']];
        g+=line('M245 118H348')+broken('M438 157V270',438,212)+broken('M348 307H245',297,307)+broken('M160 270V157',160,212);
        p.forEach(([x,y,v])=>g+=box(x,y,170,75,v));
        g+=text(300,213,'相同问题可能再次出现','viz-small');break;
      }
      default: throw new Error(`Missing lifecycle pain diagram: ${s.type}`);
    }
    return g;
  }

  function sceneGraphic(s,k) {
    const frameIndex=k;
    const isLifecycle=s.chapter==='lifecycle';
    if(isLifecycle)k=Math.max(0,k-1);
    if(s.type==='lifecycle')k*=1.5;
    let g='';
    const labels=['业务决定','共享规范','受控实现','独立 QA','发布决定','运营反馈'];
    switch(s.type) {
      case 'hero': case 'closing': {
        g=`<circle cx="300" cy="207" r="145" fill="none" stroke="#9cd26930"/><circle cx="300" cy="207" r="113" fill="none" stroke="#c9e0b735" stroke-dasharray="2 9"/><circle cx="300" cy="207" r="76" class="halo"/><g class="spin-in"><path d="M300 62a145 145 0 0 1 125 217" stroke="#86bc25" stroke-width="2" fill="none" class="draw"/></g>`;
        const ps=[[300,62],[425,135],[425,280],[300,352],[175,280],[175,135]];
        ps.forEach(([x,y],i)=>{g+=group(i<=k*2+1,`<circle cx="${x}" cy="${y}" r="6" fill="#86bc25"/>${text(x+(x>310?27:x<290?-27:0),y+(x===300?(y<100?-18:28):5),labels[i],'viz-small',x>310?'start':x<290?'end':'middle')}`);});
        g+=`<rect x="217" y="155" width="166" height="105" rx="2" fill="#102f20" stroke="#8aba50"/>${text(300,180,'ONE BUSINESS CHANGE','viz-mono')}${text(300,215,'一次业务变更','viz-big')}${text(300,243,k===0?'INTENT':k===1?'EVIDENCE':'IMPACT','viz-mono')}`;
        break;
      }
      case 'comparison': {
        g+=text(139,34,'AI Coding / Vibe Coding','viz-label')+text(461,34,'AISDLC','viz-label viz-accent');
        g+=text(139,54,'聚焦局部产出与快速迭代','viz-small')+text(461,54,'组织端到端业务交付','viz-small');
        const rows=[
          ['管理对象','一次提示 / 一段代码','围绕一个功能推进','一次业务变更','围绕端到端结果推进'],
          ['执行依据','提示词与对话上下文','人持续补充背景','共享规范与版本化上下文','已确认的业务决定'],
          ['协作方式','生成 → 检查 → 修改','由人串联各环节','阶段关联与责任交接','需求 → 设计 → 开发 → QA → 发布 → 运营'],
          ['质量判断','自测与人工 Review','检查生成结果是否符合预期','独立验证与可追溯证据','组件 / 系统契约 / 业务旅程'],
          ['人的工作','补背景 / 查输出 / 协调修改','持续参与检查与返工','定义 / 编排 / 验证 / 判断','更有组织地承担关键判断'],
          ['完成标准','功能能跑 / 修改完成','局部完成点','获准发布 → 验证业务结果','区分执行、质量、批准与部署'],
        ];
        rows.forEach(([label,left,leftSub,right,rightSub],i)=>{
          const y=74+i*48,active=Math.floor(i/2)===k;
          g+=box(16,y,246,42,left,leftSub,false);
          g+=text(300,y+14,label,'viz-small')+flow(`M270 ${y+29}H330`,active);
          g+=group(true,box(338,y,246,42,right,rightSub,active),active);
        });
        g+=line('M16 377H584')+text(300,401,'关注重心的扩展 · AI Coding 也可以具备严谨的工程实践','viz-small');
        break;
      }
      case 'efficiency': {
        const queue=k>=1;
        g+=text(300,43,'从生成速度，看整条交付链','viz-big');
        g+=box(25,126,137,91,'AI 生成','代码 / 文档 / 变更',true);
        g+=flow('M162 171H224',true)+box(224,126,167,91,'人工 Review',queue?'理解 · 检查 · 判断':'变更进入审查',queue);
        g+=flow('M391 171H438',k===0)+box(438,126,137,91,'可接受交付',queue?'等待证据与决定':'完整交付链');
        // A finite stream becomes a visible review queue, with no implied real counts.
        const count=queue?5:2;
        for(let i=0;i<count;i++) {
          const x=236+i*26;
          g+=`<g class="queue-card" style="--packet-delay:${i*100}ms"><rect x="${x}" y="87" width="21" height="25" fill="#294822" stroke="${queue?'#d6aa6b':'#86bc25'}"/><path d="M${x+5} 95h11m-11 5h8" stroke="#c9dabb" stroke-width="1"/></g>`;
        }
        if(queue)g+=text(310,70,'待审材料累积','viz-small viz-warning');
        if(k>=2) {
          g+=`<path d="M309 217V284H94V217" class="rework-path draw"/>`;
          if(!media.matches)g+=`<circle r="3" fill="#d6aa6b"><animateMotion dur="1.8s" repeatCount="1" fill="freeze" path="M309 217V284H94V217"/></circle>`;
          g+=text(202,253,'含义不清 / 上下文缺失 / 依赖冲突','viz-small viz-warning')+text(202,307,'重新澄清 → 修改 → 验证','viz-small');
        } else {
          g+=text(300,281,queue?'审查能力跟不上时，等待就会增加':'更多产物，更快进入交付通道','viz-small');
        }
        if(k===3) {
          g+=`<rect x="25" y="337" width="550" height="52" fill="#192c1d" stroke="#69844d"/>${text(300,358,'生成节省的时间 ⇄ 审查等待 + 返工成本','viz-label')}${text(300,377,'后两项增长，可能抵消局部提速','viz-small')}`;
        } else g+=text(300,371,'关系示意 · 卡片数量不代表实测数据','viz-mono');
        break;
      }
      case 'gaps': {
        g+=text(300,53,'AI 产出 → 可接受的变更','viz-small');
        const names=['理解','执行','接受'];const subs=['目标 / 规则 / 上下文','依赖 / 授权边界','证据 / 责任'];
        names.forEach((v,i)=>{let x=34+i*190;g+=group(i<=k,box(x,149,150,88,v,subs[i],i===k));if(i<2)g+=flow(`M${x+150} 193h40`,i<k);g+=text(x+75,275,['反复澄清','冲突与返工','审查与等待'][i],'viz-small');g+=text(x+75,125,`GAP 0${i+1}`,'viz-mono');});
        g+=line('M50 315H550');g+=`<rect x="50" y="313" width="${(k+1)*166}" height="3" fill="#86bc25"/>`+text(300,351,'把局部速度连接成完整交付','viz-small');break;
      }
      case 'proofs': {
        const names=['预期行为','系统兼容性','受控执行','发布准备度'];
        [[60,70],[335,70],[60,263],[335,263]].forEach(([x,y],i)=>{g+=line(`M${x+100} ${y+(i<2?68:0)}L300 210`,i<=k);g+=group(i<=k,box(x,y,205,70,names[i],['符合业务意图','关联调用仍有效','过程与边界可审查','监控、回滚与风险'][i],i===k));});
        g+=`<circle cx="300" cy="210" r="44" fill="#173623" stroke="#86bc25"/>${documentIcon(300,205)}${text(300,238,'变更','viz-small')}`;break;
      }
      case 'lifecycle': {
        const p=[[100,107],[300,72],[500,107],[500,292],[300,334],[100,292]];
        p.forEach(([x,y],i)=>{const n=p[(i+1)%6];g+=flow(`M${x} ${y}L${n[0]} ${n[1]}`,i<=k*1.5);});
        p.forEach(([x,y],i)=>{g+=group(i<=k*1.5+1,`<rect x="${x-66}" y="${y-29}" width="132" height="58" class="viz-card ${i<=k*1.5+1?'active':''}"/>${text(x,y+5,['需求澄清','设计规范','开发实施','独立 QA','发布判断','运营反馈'][i])}`);});
        g+=text(300,196,'同一个业务意图','viz-big')+text(300,223,'ONE CONTINUOUS LIFECYCLE','viz-mono');break;
      }
      case 'questions': {
        g+=box(183,25,234,64,'一项业务请求','一个请求，六组业务决定',true);
        ['如何识别客户？','谁能看到什么？','不确定时怎么办？','推荐哪些材料？','后续如何交接？','试点如何监控？'].forEach((v,i)=>{const x=i%2?320:45,y=133+Math.floor(i/2)*83;g+=line(`M300 89V${y+27}H${x+110}`,Math.floor(i/2)<=k);g+=group(Math.floor(i/2)<=k,box(x,y,235,55,v,'',Math.floor(i/2)===k));});break;
      }
      case 'decisions': {
        g+=box(30,166,132,66,'待确认问题','事实 / 假设',k===0)+flow('M162 199H232',k>=1);
        g+=group(k>=1,`<circle cx="300" cy="190" r="65" class="viz-card active"/>${person(300,177)}${text(300,224,'具名责任人')}${text(300,280,'产品 · 业务 · 架构','viz-small')}${text(300,302,'安全 · 隐私 · 运营','viz-small')}`);
        g+=flow('M367 199H433',k>=2)+group(k>=2,box(433,166,135,66,'形成 PRD','已确认的规则',true));
        g+=text(300,76,'决定在先，文档在后','viz-big');break;
      }
      case 'contract': {
        g+=`<rect x="155" y="40" width="290" height="154" fill="#edf2e8" stroke="#bed797"/>${text(300,65,'SHARED SPECIFICATION','light-mono')}${text(300,95,'跨系统执行规范','light-title')}`;
        ['行为与调用方契约','示例与反向场景','可观测性 / 发布 / 回滚'].forEach((t,i)=>g+=text(300,126+i*23,t,'light-small'));
        ['编码任务','测试判定','评审规则','发布门禁'].forEach((v,i)=>{const x=20+i*145;g+=flow(`M300 194V244H${x+62}V285`,k>=2);g+=group(k>=2,box(x,285,125,58,v,'',true));});
        g+=text(300,383,k<2?'先把共同依据写清楚':'连线表示共同依据，不表示自动生成','viz-small');break;
      }
      case 'context': {
        ['已批准行为','相关代码','调用方 / 事件契约','工程标准','测试与观测模式'].forEach((v,i)=>{g+=group(i<3||k>=1,box(20,42+i*61,166,44,v));g+=flow(`M186 ${64+i*61}L282 195`,(i<3||k>=1)&&k<2);});
        g+=`<path d="M250 100h86l-20 70v84l-46 20V170z" fill="#29512c" stroke="#86bc25"/>${text(294,312,'相关性筛选','viz-small')}`;
        g+=flow('M317 212H377',k>=1)+group(k>=1,box(377,124,203,156,'本次上下文包','可检索 · 有版本 · 可追溯',true));
        g+=group(k>=2,`<rect x="36" y="360" width="530" height="30" fill="#17281f" stroke="#48614d"/>${text(300,380,'排除：无关仓库、无关数据','viz-small')}`);break;
      }
      case 'boundary': {
        g+=`<rect x="28" y="35" width="544" height="338" fill="#0d2016" stroke="#4d6e53" stroke-dasharray="6 5"/>${text(50,62,'授权工作空间','viz-mono','start')}`;
        g+=box(55,95,205,92,'本次实现范围','可读 / 可写',k===0)+box(337,95,205,92,'调用方仓库','只读',k>=1);
        g+=flow('M260 141H337',k===1)+group(k>=0,box(55,238,205,77,'必要工具与测试','按任务范围开放',true));
        g+=group(k>=2,`<rect x="337" y="238" width="205" height="77" fill="#33291d" stroke="#ab8447"/>${text(440,267,'生产环境与凭据','viz-label viz-warning')}${text(440,291,'禁止访问','viz-small')}<path d="M327 228v100" stroke="#edab53" stroke-width="3"/>`);
        g+=text(300,403,'方法论中的边界示意 · 实际控制需工程机制支撑','viz-mono');break;
      }
      case 'ledger': {
        g+=box(26,149,150,93,'受控实施','一次业务变更',true)+flow('M176 195H222',true);
        g+=`<rect x="222" y="43" width="352" height="326" fill="#0b1a12" stroke="#416347"/>${text(245,73,'EXECUTION RECORD · 示意','viz-mono','start')}`;
        const entries=[['INPUT','提示词与上下文'],['SOURCE','来源与版本'],['ACTION','工具动作与执行过程'],['DIFF','代码差异'],['CHECK','测试与验证结果'],['EXCEPTION','异常与未解决问题']];
        entries.forEach(([a,b],i)=>{g+=group(Math.floor(i/2)<=k,`<g class="new-row">${text(245,115+i*41,a,'viz-mono','start')}${text(345,115+i*41,b,'viz-small','start')}${line(`M245 ${128+i*41}H552`)}</g>`);});break;
      }
      case 'qa': {
        g+=box(205,26,190,55,'获批规范','',true);
        g+=flow('M270 81V113H155V149',k>=0)+flow('M330 81V113H445V149',k>=1);
        g+=box(42,149,226,114,'Coding Agent','实施与自测',k===0)+group(k>=1,box(332,149,226,114,'独立 QA','独立预期与验证',true));
        g+=line('M300 122V289',false,'viz-dashed')+text(300,309,'上下文与职责分离','viz-small');
        g+=flow('M155 263V344H245',k>=2)+flow('M445 263V344H355',k>=2)+group(k>=2,box(205,321,190,59,'质量证据','',true));break;
      }
      case 'quality': {
        const tiers=[['运行与业务旅程','安全 · 可观测性 · 完整交接'],['关联系统','调用方契约 · 接口兼容'],['组件实现','单元测试 · 静态检查']];
        tiers.forEach(([a,b],i)=>{const x=38+i*45,y=60+i*80,w=524-i*90,h=300-i*80;g+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${i===0?'#10261a':i===1?'#193822':'#24442a'}" stroke="${k>=2-i?'#86bc25':'#3c5843'}" stroke-width="${k===2-i?2:1}"/>${text(x+18,y+27,a,'viz-label','start')}${text(x+18,y+49,b,'viz-small','start')}`;});
        g+=text(300,399,'验证范围逐层扩展','viz-mono');break;
      }
      case 'gate': {
        g+=box(28,165,135,70,'质量证据','验证结果',true)+flow('M163 200H232',true);
        g+=`<path d="m300 132 68 68-68 68-68-68z" fill="#223f25" stroke="#86bc25"/>${text(300,205,'质量门禁')}`;
        ['通过','阻断','人工复核'].forEach((v,i)=>{let y=52+i*126;g+=flow(`M368 200H405V${y+30}H440`,i===k||k===2);g+=group(i===k||k===2,box(440,y,135,62,v,'',true));});
        g+=text(300,389,['交给下游使用','返回对应环节补齐','交给人作出判断'][k],'viz-small');break;
      }
      case 'chain': case 'summary': {
        const list=s.type==='chain'?['业务决定','执行规范','受控实现','独立 QA','生产准备']:['意图确认','共享规范','受控执行','独立验证','人工决定'];
        list.forEach((v,i)=>{let x=18+i*117;g+=group(i<3||k>=1,box(x,154,98,76,v,['有责任人','有共同依据','有行动边界','有质量证据','有风险判断'][i],i<=k+2));if(i<4)g+=flow(`M${x+98} 192h19`,i<=k+1);g+=text(x+49,133,`0${i+1}`,'viz-mono');});
        g+=group(k>=2,flow('M552 230V314H67V230',true)+text(300,342,s.type==='summary'?'运营反馈检验意图，推动下一轮交付':'监控 · 回滚 · 未关闭风险','viz-small'));
        g+=text(300,62,'围绕同一次业务变更','viz-big');break;
      }
      case 'release': {
        g+=`<rect x="30" y="77" width="225" height="253" fill="#edf2e8" stroke="#bdd798"/>${text(50,106,'EVIDENCE CASE','light-mono','start')}${text(50,139,'交付证据档案','light-title','start')}`;
        ['已验证要求','独立质量证据','未关闭风险与责任人','监控与回滚准备'].forEach((v,i)=>g+=text(51,183+i*34,v,'light-small','start'));
        g+=flow('M255 202H317',k>=1)+group(k>=1,person(354,136)+text(354,176,'发布责任人','viz-small'));
        ['发布','暂缓','拒绝'].forEach((v,i)=>g+=group(k>=1,box(406,69+i*107,155,64,v,['接受剩余风险','补齐证据再判断','返回目标与边界'][i],i===k-1)));
        g+=group(k>=2,flow('M483 347V375H140V331')+text(300,402,'可追溯地返回原始决定与相关产物','viz-mono'));break;
      }
      case 'operations': {
        g+=text(50,43,'运行观察 · 示意，无实测数值','viz-mono','start');
        ['契约错误','通知送达','旅程成功'].forEach((v,i)=>{const y=89+i*77;g+=text(32,y+13,v,'viz-small','start');g+=line(`M123 ${y+27}H560`);const d=`M125 ${y+8}l30 -4 28 11 32 -18 30 8 32 -3 30 ${i===0?20:-10} 30 ${i===0?-7:3} 32 4 32 -10 35 6 30 -3 40 -2`;g+=`<path d="${d}" fill="none" stroke="${i===0?'#d4b27a':'#86bc25'}" stroke-width="2" class="chart-reveal"/>`;});
        g+=group(k>=1,box(130,337,155,49,'回滚 / 安全降级','',true))+group(k>=2,box(328,337,210,49,'据运行事实判断业务目标','',true));break;
      }
      case 'learning': {
        const p=[[75,82,'运行事实'],[348,82,'问题归因'],[348,270,'经确认的学习'],[75,270,'下一轮交付']];
        g+=flow('M245 118H348',k>=1)+flow('M438 157V270',k>=1)+flow('M348 307H245',k>=2)+flow('M160 270V157',k>=2);
        p.forEach(([x,y,v],i)=>g+=group(i<=k+1,box(x,y,170,75,v,'',i===k)));
        g+=text(300,213,'反馈有来源，改进有依据','viz-small');break;
      }
      case 'human': {
        g+=person(300,185)+text(300,234,'人','viz-big');
        const pp=[[62,55,'定义目标','业务含义与标准'],[363,55,'编排条件','上下文与边界'],[62,290,'验证结果','独立证据与缺口'],[363,290,'判断风险','具名决定与责任']];
        pp.forEach(([x,y,a,b],i)=>{g+=flow(`M300 205L${x+87} ${y+40}`,i<=k+1);g+=group(i<=k+1,box(x,y,175,78,a,b,i===k+1));});break;
      }
      case 'shared': {
        const roles=['需求','开发','测试','发布'];
        roles.forEach((v,i)=>{const x=47+i*142;g+=box(x,59,100,54,v,'',k>=1);if(i<3)g+=line(`M${x+100} 86h42`,false,'viz-dashed');});
        g+=group(k>=1,box(173,190,254,87,'共享规范','同一个业务含义',true));
        roles.forEach((_,i)=>g+=flow(`M${97+i*142} 113V153H300V190`,k>=1));
        g+=group(k>=2,box(173,328,254,53,'决定 ⇄ 实现 ⇄ 验证状态','',true)+flow('M300 277V328'));
        if(k===0)g+=text(300,235,'独立交接时，背景可能丢失','viz-small');break;
      }
      case 'responsibility': {
        [['业务与专业责任方','确认业务含义'],['Coding Agent','实施获准变更'],['独立 QA','证明交付质量'],['发布责任人','接受生产风险']].forEach(([a,b],i)=>{let y=51+i*85;g+=group(i===0||k>=1,`<rect x="35" y="${y}" width="530" height="63" fill="${i===0||i===3?'#1b3522':'#10281d'}" stroke="#36563d"/>${text(54,y+35,a,'viz-small','start')}${line(`M222 ${y+31}H290`,i<=k+1)}${text(430,y+35,b)}${check(313,y+31,i<=k+1)}`);});break;
      }
      case 'platform': {
        g+=text(300,36,'目标能力结构 · 非产品功能清单','viz-mono');
        g+=group(k>=2,box(42,61,516,66,'角色 · 决策权 · 能力要求与移交','组织机制',true));
        [['规范','上下文','Agent 执行','质量保证'],['证据台账','策略控制','运营反馈','持续改进']].forEach((row,j)=>row.forEach((v,i)=>g+=group(j===0||k>=1,box(42+i*132,157+j*73,120,55,v,'',j===k))));
        g+=box(42,329,516,57,'现有 DevOps 与工程工具链','',true)+flow('M300 285V329',k>=1);break;
      }
      case 'paradigm': {
        [['代码',70],['文档',171],['测试',272]].forEach(([v,y],i)=>{g+=box(40,y,125,61,v);g+=flow(`M165 ${y+30}L305 202`,k>=1);});
        g+=group(k>=1,`<circle cx="306" cy="202" r="29" fill="#294b24" stroke="#86bc25"/>${text(306,207,'关联')}`)+flow('M335 202H391',k>=2);
        g+=group(k>=2,box(391,137,175,130,'可接受的变更','完整业务依据',true));break;
      }
      case 'risk': {
        g+=text(300,45,'不确定性在何时被看见？','viz-big');
        const ns=['需求','设计','实施','QA','发布'];
        ns.forEach((v,i)=>{let x=75+i*115;g+=text(x,342,v,'viz-small');g+=line(`M${x} 89V319`,false,'viz-dashed');g+=`<circle cx="${x}" cy="${[140,170,205,233,260][i]}" r="${i<=k+1?6:3}" fill="${i<=k+1?'#86bc25':'#668367'}"/>`;});
        g+=`<path d="M75 140Q190 167 305 205T535 260" class="viz-line on chart-reveal"/><path d="M75 286Q295 298 420 222T535 111" stroke="#ad9874" fill="none" stroke-width="1.2" stroke-dasharray="5 5"/>`;
        g+=text(87,109,'沿途暴露与处理','viz-small','start')+text(527,83,'后期集中发现','viz-small','end')+text(300,384,'概念示意，无量化刻度或效果承诺','viz-mono');break;
      }
      case 'outcome': {
        const p=[[34,56,'效率','周期 / 等待'],[317,56,'质量','集成缺陷 / 返工'],[34,260,'控制','证据完整 / 异常时长'],[317,260,'运营','旅程成功 / 恢复时间']];
        p.forEach(([x,y,a,b],i)=>{g+=line(`M${x+124} ${y+44}L300 205`,true);g+=group(i<2||k>=1,box(x,y,246,88,a,b,(k===0&&i<2)||i===k+1));});
        g+=`<rect x="136" y="173" width="328" height="64" fill="#edf2e8" stroke="#86bc25"/>${text(300,201,'达到可接受变更的交付时间','light-title')}${text(300,222,'将四类指标结合起来观察','light-small')}`;break;
      }
      case 'capability': {
        const p=[[45,61,'共同设计'],[333,61,'共同交付'],[333,271,'能力移交'],[45,271,'持续改进']];
        g+=flow('M245 103H333',true)+flow('M433 145V271',k>=1)+flow('M333 313H245',k>=2)+flow('M145 271V145',k>=2);
        p.forEach(([x,y,v],i)=>g+=group(i<=k+1,box(x,y,200,83,v,'',i===k+1)));
        g+=text(300,207,'企业拥有的可复用能力','viz-big');break;
      }
      case 'product': {
        g+=box(180,25,240,62,'工作区','成员 · 项目 · 共享背景',true);
        ['任务','运行时','Agent Family'].forEach((v,i)=>{g+=flow(`M300 87V129H${105+i*195}V171`,k>=1);g+=group(k>=1,box(25+i*195,171,160,73,v,['组织协作','执行工作','阶段分工'][i],true));});
        g+=group(k>=2,box(115,311,370,66,'Work Item · 交付记录','契约 · 证据 · 决定',true)+flow('M300 244V311'));break;
      }
      case 'prepare': {
        [['01','账号','注册 / 登录'],['02','工作区','创建 / 加入'],['03','运行时','连接电脑与 AI 工具']].forEach(([n,a,b],i)=>{let x=25+i*195;g+=group(i<=k,`<circle cx="${x+80}" cy="100" r="22" fill="${i===k?'#86bc25':'#dce7d4'}"/>${text(x+80,105,n,'viz-label')}${box(x,156,160,103,a,b,i===k)}`);if(i<2)g+=flow(`M${x+160} 207h35`,i<k);});
        g+=text(300,330,'已有团队环境可以复用','viz-small');break;
      }
      case 'setup': {
        g+=box(25,132,180,126,'项目上下文','代码 + 背景 + 规则',k===0)+flow('M205 195H267',k>=1);
        g+=group(k>=1,`<rect x="267" y="44" width="309" height="294" fill="#fff" stroke="#b9cdae"/>${text(420,79,'AI-SDLC Delivery','viz-label')}`);
        ['Intake','Explore','Contract','Build','QA','Release','Operate','Learn','Orchestrator'].forEach((v,i)=>{g+=group(k>=1,box(282+i%3*96,107+Math.floor(i/3)*68,83,49,v,'',k===2));});
        g+=text(300,385,'九个智能体角色 · 十个 sdlc-* skill','viz-small');break;
      }
      case 'rules': {
        g+=box(27,68,222,267,'.sdlc/','项目级规则',k===0);
        const roles=['业务负责人','架构','开发','QA','运维'];
        roles.forEach((r,i)=>g+=group(k>=1,box(344,40+i*68,222,51,r,['目标与验收','方案与边界','实现方向','验证充分性','发布与恢复'][i],k===1)));
        g+=flow('M249 200H344',k>=1)+group(k>=2,`<rect x="40" y="354" width="520" height="37" fill="#e3f0d4" stroke="#7fa645"/>${text(300,378,'下一阶段读到有效的契约、代码与证据版本','viz-small')}`);break;
      }
      case 'firsttask': {
        g+=`<rect x="54" y="40" width="492" height="191" fill="#fff" stroke="#c3d4ba"/>${text(78,70,'FIRST WORK ITEM','viz-mono','start')}${text(78,103,'修复 CSV 导出负数金额丢失负号','viz-label','start')}${text(78,140,'目标：导出金额与页面一致','viz-small','start')}${text(78,171,'负责人 · 仓库 · 范围 · 候选验收标准','viz-small','start')}${text(78,203,'先确认事实，再形成获批契约','viz-small','start')}`;
        ['执行结束','交付通过','业务效果成立'].forEach((v,i)=>{let x=32+i*191;g+=group(k>=1,box(x,297,160,66,v,'',i<=k-1));if(i<2)g+=flow(`M${x+160} 330h31`,k>=2);});break;
      }
      default: throw new Error(`Unknown scene type: ${s.type}`);
    }
    if(isLifecycle&&frameIndex===0)g=painGraphic(s);
    return `<svg viewBox="0 0 600 420" role="img" aria-label="${escape(s.title.replace(/\n/g,''))}：${escape(s.frames[frameIndex][1])}"><style>.badge-text{font:10px sans-serif;fill:#0b1f12}.light-title{font:16px 'Noto Sans SC',sans-serif;fill:#203d26}.light-small{font:11px 'Noto Sans SC',sans-serif;fill:#46644b}.light-mono{font:9px monospace;fill:#496a42;letter-spacing:1px}</style>${g}</svg>`;
  }

  function updateMotionButton() {
    $('#motion-toggle').innerHTML = paused ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 4 10 6-10 6z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4v12M13 4v12"/></svg>';
    $('#motion-toggle').setAttribute('aria-label',paused?'播放场景动画':'暂停场景动画');
    $('#motion-toggle').title=paused?'播放场景动画':'暂停场景动画';
    $('#motion-toggle').setAttribute('aria-pressed',String(paused));
    document.body.classList.toggle('paused',paused);
    const svg=$('#visual svg');
    if(svg && typeof svg.pauseAnimations==='function') { if(paused||media.matches)svg.pauseAnimations();else svg.unpauseAnimations(); }
  }
  function schedule() {
    if(timer)return;
    if(!paused&&!media.matches&&!document.hidden&&!document.querySelector('dialog[open]')&&frame<scenes[page].frames.length-1) {
      deadline=performance.now()+remaining;
      timer=setTimeout(()=>{timer=null;frame++;renderFrame();},remaining);
    }
  }
  function renderFrame() {
    stopTimer();
    remaining=frameDuration;
    const s=scenes[page];
    $('#visual').innerHTML=sceneGraphic(s,frame);
    const state=$('#process-state');
    if(state){state.textContent=frame===0?'当前痛点':frame===s.frames.length-1?'形成结果':'AISDLC 如何解决';state.classList.toggle('pain-state',frame===0);}
    document.querySelectorAll('.narrative-item').forEach(el=>el.classList.toggle('emphasized',el.dataset.narrative===(frame===0?'pain':'solution')));
    const current=s.frames[frame];
    $('#caption').innerHTML=`<span class="caption-number">${String(frame+1).padStart(2,'0')}</span><div class="caption-copy"><strong>${escape(current[0])}</strong><p>${escape(current[1])}</p><div class="caption-track ${frame===s.frames.length-1?'finished':''}" aria-hidden="true"><span></span></div></div>`;
    document.querySelectorAll('[data-frame]').forEach(el=>{const active=Number(el.dataset.frame)===frame;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
    updateMotionButton();schedule();
  }
  function stageNavigation(s) {
    if(s.chapter!=='lifecycle')return '';
    const index=stages.findIndex(v=>v.id===s.stage);
    const position=index<0?'全生命周期总览':`当前阶段 ${String(index+1).padStart(2,'0')} / 06 · ${stages[index].name}`;
    return `<section class="lifecycle-position" aria-label="生命周期位置"><div class="stage-heading"><strong>${escape(position)}</strong>${index<0?'':`<span>${escape(s.subtopic)}</span>`}</div><nav class="stage-path" aria-label="生命周期阶段">${stages.map((v,i)=>`<button class="stage-node ${i===index?'current':''}" data-go="${v.start}" ${i===index?'aria-current="step"':''}><span class="stage-number">0${i+1}</span>${escape(v.name)}</button>`).join('')}</nav></section>`;
  }
  function narrative(s) {
    if(s.chapter!=='lifecycle')return `<p class="lead">${escape(s.lead)}</p>`;
    return `<div class="narrative"><div class="narrative-item" data-narrative="pain"><strong>当前痛点</strong><p>${escape(s.pain)}</p></div><div class="narrative-item" data-narrative="solution"><strong>AISDLC 如何解决</strong><p>${escape(s.solution)}</p></div></div>`;
  }
  function render() {
    stopTimer();
    const s=scenes[page],hero=s.type==='hero'||s.type==='closing',product=s.chapter==='product'&&!hero;
    const extras=s.type==='hero'?`<div class="hero-buttons"><button class="primary-button" data-go="delivery-model">开始理解方法 ${arrow}</button><button class="secondary-button" data-go="product-intro">简要认识 Enact ${arrow}</button></div><div class="hero-annotation"><span class="small-dot"></span>27 幕方法论 · 5 幕产品介绍 · 自主掌握节奏</div>`:s.type==='closing'?`<div class="hero-buttons"><button class="primary-button" data-read>阅读完整指南 ${arrow}</button><button class="secondary-button" data-copy>复制任务模板 ${arrow}</button><button class="secondary-button" data-go="delivery-model">重看方法论</button></div>`:'';
    $('#scene').innerHTML=`<article class="scene ${hero?s.type:''} ${product?'product-scene':''} ${s.chapter==='lifecycle'?'lifecycle-scene':''}"><div class="scene-header"><span class="eyebrow">${escape(s.eyebrow)}</span><span class="scene-tag">${hero?'AN INTERACTIVE STORY':product?'PRODUCT OVERVIEW':'METHODOLOGY IN MOTION'}</span></div>${stageNavigation(s)}<div class="scene-body"><div class="scene-copy"><h1 id="scene-title" tabindex="-1">${escape(s.title).replace(/\n/g,'<br>')}</h1><div class="keyline"></div>${narrative(s)}${extras}<div class="step-list" aria-label="分步讲解">${s.frames.map((f,i)=>`<button class="step-button" data-frame="${i}" aria-pressed="false"><span class="step-num">0${i+1}</span><span class="step-label">${escape(f[0])}</span>${arrow}</button>`).join('')}</div><p class="takeaway">${escape(s.takeaway)}</p></div><div class="visual-column"><div class="visual-panel"><div class="visual-topline"><span ${s.chapter==='lifecycle'?'id="process-state"':''}>${product?'ENACT / CONCEPT MAP':'ONE BUSINESS CHANGE'}</span><span>${product?'教学示意':'FROM INTENT TO IMPACT'}</span></div><div id="visual"></div><span class="scene-note">${product?'CONCEPTUAL OVERVIEW · NO LIVE CONNECTION':s.type==='risk'?'CONCEPTUAL ILLUSTRATION · NOT MEASURED DATA':'AISDLC / CONNECTED DELIVERY'}</span></div><div class="visual-caption" id="caption"></div></div></div><div class="scene-bottom"><button class="detail-trigger" id="detail-trigger" aria-expanded="false" aria-controls="scene-detail">补充解释与适用边界 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button></div><div class="detail-box" id="scene-detail" hidden>${escape(s.detail)}</div></article>`;
    $('#chapter-list').innerHTML=chapters.map((c,i)=>{const chapterIndex=chapters.findIndex(c=>c.id===s.chapter);return `<button class="chapter-button ${i===chapterIndex?'active':i<chapterIndex?'passed':''}" data-go="${c.start}" ${i===chapterIndex?'aria-current="step"':''}><span class="chapter-number">0${i+1}</span><span><strong>${escape(c.name)}</strong><small>${c.sub}</small></span></button>`;}).join('');
    $('#page-number').textContent=String(page+1).padStart(2,'0');$('#page-total').textContent=scenes.length;
    $('#part-label').textContent=`${s.chapter==='product'?'产品':'方法论'} · ${chapters.find(c=>c.id===s.chapter).name}`;
    $('#timeline').innerHTML=scenes.map((v,i)=>`<button class="timeline-segment ${i===page?'current':i<page?'past':''} ${i&&v.chapter!==scenes[i-1].chapter?'chapter-start':''}" data-go="${v.id}" aria-label="第 ${i+1} 页：${escape(v.title.replace(/\n/g,''))}" ${i===page?'aria-current="step"':''} title="${escape(v.title.replace(/\n/g,''))}"></button>`).join('');
    $('#previous').disabled=page===0;$('#next').disabled=page===scenes.length-1;
    $('#next span').textContent=page===0?'开始旅程':s.id==='method-summary'?'走进 Enact':page===scenes.length-1?'旅程完成':'下一幕';
    document.querySelectorAll('.top-link[data-go]').forEach(el=>el.classList.toggle('active',(el.dataset.go==='product-intro')===(s.chapter==='product')));
    if(!hero){const zoom=document.createElement('button');zoom.className='zoom-button';zoom.dataset.zoom='';zoom.setAttribute('aria-label','放大当前图解');zoom.textContent='放大图解 ↗';$('.visual-topline').lastElementChild.replaceWith(zoom);}
    frame=media.matches?s.frames.length-1:0;renderFrame();save();
    const currentStage=$('.stage-node.current');
    if(currentStage){const path=currentStage.parentElement;path.scrollLeft+=currentStage.getBoundingClientRect().left-path.getBoundingClientRect().left-(path.clientWidth-currentStage.offsetWidth)/2;}
    document.title=`${s.title.replace(/\n/g,'')} — Enact × AISDLC`;
  }
  function go(id, focus=true) {
    const target=scenes.findIndex(s=>s.id===id);if(target<0)return;
    page=target;
    try { history.pushState(null,'',`#${id}`); } catch { location.hash=id; }
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    render();window.scrollTo({top:0,behavior:'instant'});
    if(focus)$('#scene-title').focus({preventScroll:true});
  }
  function route() {const index=scenes.findIndex(s=>s.id===location.hash.slice(1));page=index>=0?index:0;render();}
  function openContents() {
    $('#contents-grid').innerHTML=chapters.map((c,i)=>`<section class="contents-section"><h3>0${i+1} / ${escape(c.name)}</h3>${scenes.map((s,n)=>s.chapter===c.id?`<button class="contents-scene ${n===page?'current':''}" data-go="${s.id}"><span>${String(n+1).padStart(2,'0')}</span><span>${escape(s.title.replace(/\n/g,''))}</span></button>`:'').join('')}</section>`).join('');
    $('#contents-dialog').showModal();suspend();
  }
  function stopTimer(){if(timer){remaining=Math.max(0,deadline-performance.now());clearTimeout(timer);timer=null;}}
  function suspend() {stopTimer();document.body.classList.add('paused');const svg=$('#visual svg');if(svg)svg.pauseAnimations();}
  function message(value){$('#toast').textContent=value;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
  const template=`标题：<明确的小范围业务变更>\n\n业务目标：\n<希望改变的可观察结果>\n\n当前事实与问题：\n<复现方式、已知信息、仍需确认的假设>\n\n仓库与起始版本：\n<仓库 / 分支或版本>\n\n任务负责人：\n<真实姓名；阶段职责按已确认的项目配置执行>\n\n初步范围：\n<本次要做什么、边界在哪里>\n\n候选验收标准：\n<可验证的预期行为；经澄清后由 Contract 阶段固化>\n\n请先登记工作、核对上下文并集中提出未决问题。\n遇到人工关口时，说明批准对象、版本、证据、风险与下一步。`;
  async function copyTemplate() {
    try {await navigator.clipboard.writeText(template);message('任务模板已复制，请替换为项目的真实信息。');}
    catch {const el=document.createElement('textarea');el.value=template;el.style.position='fixed';el.style.left='-9999px';document.body.appendChild(el);el.select();const copied=document.execCommand('copy');el.remove();if(copied)message('任务模板已复制。');else {openReader();$('#guide-search').value='标题：';renderReader();message('复制不可用，已打开指南中的任务模板。');}}
  }
  function inline(value){return escape(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1');}
  function markdown(value){
    let inCode=false,rows=[];
    for(const raw of value.split('\n')) {
      if(raw.startsWith('```')){rows.push(inCode?'</pre>':'<pre>');inCode=!inCode;continue;}
      if(inCode){rows.push(escape(raw)+'\n');continue;}
      if(!raw.trim()||raw==='---')continue;
      const heading=raw.match(/^(#{1,6})\s+(.*)/);
      if(heading){const level=Math.min(4,heading[1].length+1);rows.push(`<h${level}>${inline(heading[2])}</h${level}>`);}
      else if(/^\|[\s|:-]+\|$/.test(raw))continue;
      else if(raw.startsWith('|'))rows.push(`<div class="md-row">${inline(raw.replace(/^\||\|$/g,'').replace(/\|/g,'　·　'))}</div>`);
      else rows.push(`<p>${inline(raw.replace(/^>\s?/,''))}</p>`);
    }
    if(inCode)rows.push('</pre>');return rows.join('');
  }
  function renderReader(){
    const query=$('#guide-search').value.trim().toLowerCase();
    const sections=(window.GUIDE_FULL_TEXT||'').split(/(?=^##\s)/m);
    const matches=sections.filter(s=>!query||s.toLowerCase().includes(query));
    $('#reader-body').innerHTML=matches.length?matches.map(s=>`<section class="reader-section">${markdown(s)}</section>`).join(''):'<p>未找到匹配内容。试试“证据”“工作区”或“运行时”。</p>';
  }
  function openReader(){renderReader();$('#reader-dialog').showModal();suspend();}
  function openGraphic(){
    const s=scenes[page];$('#graphic-title').textContent=s.frames[frame][0];
    $('#graphic-body').classList.toggle('product-scene',s.chapter==='product');
    $('#graphic-body').innerHTML=sceneGraphic(s,frame);
    $('#graphic-body').querySelectorAll('animateMotion').forEach(el=>el.remove());
    $('#graphic-dialog').showModal();suspend();
  }
  document.addEventListener('click',e=>{
    const download=e.target.closest('a[data-document]');
    if(download){
      e.preventDefault();
      const source=download.dataset.document==='source';
      const url=URL.createObjectURL(new Blob([source?window.GUIDE_SOURCE_TEXT:window.GUIDE_FULL_TEXT],{type:'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=source?'方法论原文.md':'完整用户指南.md';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    const target=e.target.closest('button');if(!target)return;
    if(target.dataset.go){go(target.dataset.go);return;}
    if(target.dataset.frame!==undefined){frame=Number(target.dataset.frame);renderFrame();return;}
    if(target.dataset.close){document.getElementById(target.dataset.close).close();return;}
    if(target.hasAttribute('data-read')){openReader();return;}
    if(target.hasAttribute('data-copy')){copyTemplate();return;}
    if(target.hasAttribute('data-zoom')){openGraphic();return;}
    switch(target.id){
      case 'next':if(page<scenes.length-1)go(scenes[page+1].id);break;
      case 'previous':if(page>0)go(scenes[page-1].id);break;
      case 'motion-toggle':if(!paused)stopTimer();paused=!paused;updateMotionButton();save();schedule();break;
      case 'replay':frame=0;renderFrame();break;
      case 'contents-button':case 'mobile-contents':openContents();break;
      case 'read-button':openReader();break;
      case 'detail-trigger':{const el=$('#scene-detail');el.hidden=!el.hidden;target.setAttribute('aria-expanded',String(!el.hidden));break;}
    }
  });
  $('#guide-search').addEventListener('input',renderReader);
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{updateMotionButton();schedule();}));
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]')||e.target.closest('input,textarea,select')||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='ArrowRight'&&page<scenes.length-1){e.preventDefault();go(scenes[page+1].id);}
    if(e.key==='ArrowLeft'&&page>0){e.preventDefault();go(scenes[page-1].id);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else{updateMotionButton();schedule();}});
  media.addEventListener('change',()=>{if(media.matches)paused=true;renderFrame();save();});
  addEventListener('hashchange',route);
  if(!location.hash&&scenes.some(s=>s.id===saved.scene)){
    try{history.replaceState(null,'',`#${saved.scene}`);}catch{/* Initial default remains available. */}
  }
  route();
})();

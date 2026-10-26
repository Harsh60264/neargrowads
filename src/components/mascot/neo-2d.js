/* NearGrow Ads NEO • standalone SVG renderer • no WebGL or external dependencies.
 * Integration API: window.createNeo2D(host, options). See README.md.
 */
(function (global) {
  'use strict';
  let nextId = 0;
  const names = ['happy', 'excited', 'wink', 'laugh', 'confident', 'curious'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function createNeo2D(host, options = {}) {
    if (!(host instanceof Element)) throw new TypeError('NEO needs a host element');
    const id = 'ngaNeo' + (++nextId) + '-';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const wrap = document.createElement('div');
    wrap.className = 'nga-neo2d';
    wrap.style.cssText = 'position:relative;display:block;flex:none;aspect-ratio:1/2;pointer-events:none;isolation:isolate;';
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400" fill="none" aria-hidden="true" style="display:block;width:100%;height:100%;overflow:visible">
      <defs>
        <linearGradient id="${id}white" x1=".2" y1="0" x2=".9" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#ffffff"/><stop offset=".65" stop-color="#ffffff"/><stop offset="1" stop-color="#daecdc"/></linearGradient>
        <linearGradient id="${id}metal"><stop stop-color="#596460"/><stop offset=".45" stop-color="#b9c8be"/><stop offset="1" stop-color="#293c35"/></linearGradient>
        <linearGradient id="${id}face" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#20342b"/><stop offset=".45" stop-color="#081510"/><stop offset="1" stop-color="#020b07"/></linearGradient>
        <linearGradient id="${id}fire" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff47a"/><stop offset=".4" stop-color="#ffcd14"/><stop offset=".78" stop-color="#ff9500"/><stop offset="1" stop-color="#ff6400" stop-opacity="0"/></linearGradient>
        <radialGradient id="${id}halo"><stop stop-color="#c5ff8d" stop-opacity=".8"/><stop offset=".25" stop-color="#a5ff49" stop-opacity=".35"/><stop offset="1" stop-color="#8dff46" stop-opacity="0"/></radialGradient>
        <filter id="${id}glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.1"/></filter>
        <clipPath id="${id}screen"><rect x="73" y="77" width="65" height="44" rx="15"/></clipPath>
        <g id="${id}logo"><path d="M0 12C-18 8-18-8-14-12C-3-10 2 1 0 12" fill="#429e20"/><path d="M0 12C-7-1-5-20 2-23C12-15 10 4 0 12" fill="#6ac629"/><path d="M0 12C2-1 13-11 19-6C22 3 12 12 0 12" fill="#f5a623"/></g>
      </defs>
      <g data-part="particles"></g>
      <g data-part="float">
        <g data-part="flame">
          <path d="M84 239L100 310L116 239Z" fill="url(#${id}fire)"/>
          <path d="M89 239L100 298L111 239Z" fill="#fff22c" opacity=".95"/>
          <path d="M94 239L100 282L106 239Z" fill="#f3ffe6"/>
          <path d="M84 242L89 257L89 240M112 241L109 266L116 239" fill="#ffb11b"/>
        </g>
        <g data-part="body">
          <path d="M84 217L116 217L112 240L89 240Z" fill="#15291f"/>
          <path d="M86 231L114 231" stroke="#7eff2b" stroke-width="2"/>
          <rect x="92" y="131" width="18" height="18" rx="5" fill="#22382d"/>
          <ellipse cx="101" cy="144" rx="17" ry="3.5" fill="#91ff35"/>
          <g data-part="left-arm">
            <path d="M65 164Q48 167 38 151L34 137" stroke="#23372c" stroke-width="9" stroke-linecap="round"/>
            <ellipse cx="65" cy="162" rx="13" ry="12" fill="url(#${id}white)"/>
            <path d="M37 153L33 136" stroke="#fbfffb" stroke-width="14" stroke-linecap="round"/>
            <ellipse cx="32" cy="130" rx="7" ry="8" fill="#20342a"/>
            <path d="M29 125L29 112M35 125L36 119" stroke="#22372b" stroke-width="4" stroke-linecap="round"/>
            <path d="M28 140L35 139" stroke="#d0e5d3" stroke-width="2"/>
          </g>
          <ellipse cx="101" cy="183" rx="36" ry="39" fill="url(#${id}white)" stroke="#dbe8dc" stroke-width=".65"/>
          <path d="M73 165Q63 192 82 210" stroke="white" stroke-width="5" stroke-linecap="round" opacity=".85"/>
          <path d="M82 216Q101 222 121 215" stroke="#a4f458" stroke-width="2"/>
          <use href="#${id}logo" transform="translate(103 183) scale(.57)"/>
          <g data-part="right-arm">
            <path d="M137 164L149 182L153 209" stroke="#20372b" stroke-width="8" stroke-linecap="round"/>
            <ellipse cx="137" cy="163" rx="12" ry="11" fill="url(#${id}white)"/>
            <circle cx="149" cy="182" r="6" fill="#1c3026"/>
            <path d="M150 188L153 201" stroke="#f5fff4" stroke-width="13"/>
            <circle cx="154" cy="209" r="7" fill="#20382b"/>
            <path d="M153 214L154 225" stroke="#273e32" stroke-width="4" stroke-linecap="round"/>
            <g transform="rotate(-14 153 195)"><rect x="143" y="181" width="23" height="29" rx="2" fill="#263b31"/><path d="M144 183H162V206H144Z" fill="#eff5ef"/><use href="#${id}logo" transform="translate(153 196) scale(.2)"/></g>
          </g>
        </g>
        <g data-part="head">
          <path d="M57 80C52 65 54 46 59 20M137 78Q139 61 148 44" stroke="#263b30" stroke-width="3" stroke-linecap="round"/>
          <path d="M57 76C54 60 55 43 59 25M138 75L146 49" stroke="#a7c4ac" stroke-width=".8"/>
          <circle cx="59" cy="20" r="14" fill="url(#${id}halo)"/><circle cx="148" cy="44" r="13" fill="url(#${id}halo)"/>
          <circle cx="59" cy="20" r="4" fill="#a4ff52"/><circle cx="148" cy="44" r="3.7" fill="#a4ff52"/>
          <rect x="43" y="86" width="20" height="26" rx="4" fill="url(#${id}metal)"/>
          <ellipse cx="44" cy="98" rx="4" ry="10" fill="#263d2c" stroke="#a0f641" stroke-width="2"/>
          <rect x="141" y="85" width="17" height="26" rx="4" fill="url(#${id}metal)"/>
          <path d="M145 89H157" stroke="#e9f3e6" stroke-width="2"/>
          <ellipse cx="101" cy="98" rx="47" ry="36" fill="url(#${id}white)" stroke="#dbe8dc" stroke-width=".65"/>
          <path d="M66 82Q77 65 104 66" stroke="white" stroke-width="5" stroke-linecap="round"/>
          <rect x="73" y="77" width="65" height="44" rx="15" fill="url(#${id}face)"/>
          <path d="M83 80Q104 77 122 79" stroke="#688670" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>
          <g clip-path="url(#${id}screen)"><g data-part="face" fill="#8fff36" stroke="#8fff36" stroke-linecap="round" stroke-linejoin="round">
            <g data-part="eyes"><path data-part="left-eye"/><path data-part="right-eye"/></g>
            <path data-part="mouth" stroke-width="1.7"/>
          </g></g>
          <path d="M89 131Q102 135 112 130" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </g>
      </g>
    </svg>`;
    const activate = typeof options.onActivate === 'function' ? options.onActivate : null;
    let hit;
    if (activate) {
      hit = document.createElement('button');
      hit.type = 'button'; hit.setAttribute('aria-label', options.label || 'Open NEO chat');
      hit.style.cssText = 'position:absolute;left:14%;top:13%;width:70%;height:47%;border:0;background:transparent;cursor:pointer;pointer-events:auto;border-radius:40%;padding:0;';
      hit.addEventListener('click', activate); wrap.appendChild(hit);
    }
    host.appendChild(wrap);
    const find = p => wrap.querySelector('[data-part="'+p+'"]');
    const svg = wrap.querySelector('svg');
    const face = find('face'), head = find('head'), float = find('float'), flame = find('flame');
    const leftEye = find('left-eye'), rightEye = find('right-eye'), mouth = find('mouth');
    const leftArm = find('left-arm'), rightArm = find('right-arm'), particles = find('particles');
    let time=0, last=null, raf=0, destroyed=false, paused=false, visible=true;
    let expression='happy', holdUntil=Infinity, autoExpressions=options.autoExpressions !== false;
    let gaze={x:0,y:0}, target={x:0,y:0}, clientPoint=null, gesture='idle', gestureEnd=0;
    let size=360, blinkAt=3.4, blinkStart=-10;
    const seed = i => { const v=Math.sin(i*129.31+4.7)*43758.5453; return v-Math.floor(v); };
    const sparks = Array.from({length:26},(_,i)=>{
      const n=document.createElementNS('http://www.w3.org/2000/svg','circle');
      n.setAttribute('fill',i%3===0?'#99ed86':'#ffcc69');
      particles.appendChild(n); return n;
    });
    const leaves=Array.from({length:7},(_,i)=>{
      const n=document.createElementNS('http://www.w3.org/2000/svg','path');
      n.setAttribute('d','M0 0Q-5-7-1-12Q5-7 0 0Z');
      n.setAttribute('fill',i===4?'#edaa46':'#77b54b');particles.appendChild(n);return n;
    });
    function eyesPath(cx,cy,type,b=1) {
      if(type==='closed')return `M${cx-3.6} ${cy+1}Q${cx} ${cy-4*b} ${cx+3.6} ${cy+1}`;
      const ry=(type==='wide'?4.5:type==='narrow'?1.7:3.6)*b;
      return `M${cx-3} ${cy}a3 ${Math.max(.15,ry)} 0 1 0 6 0a3 ${Math.max(.15,ry)} 0 1 0 -6 0`;
    }
    function paintFace() {
      const blink=reduced.matches?1:(time-blinkStart<.16?Math.max(.05,Math.abs((time-blinkStart)/.08-1)):1);
      const closed=expression==='laugh';
      const lt=closed||expression==='wink'?'closed':expression==='confident'?'narrow':expression==='excited'?'wide':'normal';
      const rt=closed?'closed':expression==='confident'?'narrow':'normal';
      leftEye.setAttribute('d',eyesPath(91,94,lt,blink));
      rightEye.setAttribute('d',eyesPath(119,expression==='curious'?92:94,rt,blink));
      [leftEye,rightEye].forEach((n,i)=>{const type=i?rt:lt;n.setAttribute('fill',type==='closed'?'none':'#8fff36');n.setAttribute('stroke-width',type==='closed'?'2.5':'.8');});
      const paths={happy:'M99 109Q105 117 112 108Z',excited:'M97 108L114 108Q106 123 97 108Z',wink:'M99 109Q105 117 113 107',laugh:'M97 107L115 107Q106 125 97 107Z',confident:'M100 111Q108 114 114 107',curious:'M104 110a2.5 3 0 1 0 5 0a2.5 3 0 1 0 -5 0'};
      mouth.setAttribute('d',paths[expression]);mouth.setAttribute('fill',['wink','confident'].includes(expression)?'none':'#8fff36');
    }
    function update(dt=0) {
      if(destroyed||paused)return;
      dt=clamp(Number(dt)||0,0,.05); time+=dt;
      if(clientPoint){
        const r=svg.getBoundingClientRect();
        if(r.width&&r.height){target.x=clamp((clientPoint.x-(r.left+r.width*.505))/Math.max(r.width*1.5,80),-1,1);target.y=clamp((clientPoint.y-(r.top+r.height*.245))/Math.max(r.height*.65,100),-1,1);}
      }
      const k=reduced.matches?1:1-Math.exp(-dt*11);
      gaze.x+=(target.x-gaze.x)*k;gaze.y+=(target.y-gaze.y)*k;
      if(time>blinkAt){blinkStart=time;blinkAt=time+3+seed(Math.floor(time))*2;}
      if(time>gestureEnd)gesture='idle';
      if(time>holdUntil&&autoExpressions){expression=names[Math.floor(time/4)%names.length];holdUntil=time+4;}
      const motion=reduced.matches?0:1;
      const dancing=gesture==='dance', wave=gesture==='wave';
      const bob=Math.sin(time*2.3)*2.1*motion;
      const lean=dancing?Math.sin(time*9)*7*motion:Math.sin(time*1.3)*1.2*motion;
      float.setAttribute('transform',`translate(0 ${bob+(dancing?Math.sin(time*9)*3*motion:0)}) rotate(${lean} 101 180)`);
      head.setAttribute('transform',`translate(${gaze.x*1.8} ${gaze.y*1.1}) rotate(${gaze.x*4} 101 132)`);
      face.setAttribute('transform',`translate(${gaze.x*4} ${gaze.y*3})`);
      leftArm.setAttribute('transform',`rotate(${(wave?Math.sin(time*14)*18:dancing?Math.sin(time*9)*25:Math.sin(time*1.8)*3)*motion} 65 162)`);
      rightArm.setAttribute('transform',`rotate(${(dancing?-Math.sin(time*9)*22:Math.sin(time*1.7)*2)*motion} 137 163)`);
      flame.setAttribute('transform',`translate(100 239) scale(${1+Math.sin(time*26)*.045*motion} ${1+Math.sin(time*21)*.09*motion}) translate(-100 -239)`);
      sparks.forEach((n,i)=>{const p=(seed(i)+time*(.42+seed(i+40)*.24)*motion)%1; n.setAttribute('cx',100+Math.sin(i*3.4+p*5)*(3+p*14));n.setAttribute('cy',250+p*130);n.setAttribute('r',(1-p)*(1+seed(i+20)*1.8)+.25);n.setAttribute('opacity',Math.max(0,(1-p)*.55));});
      leaves.forEach((n,i)=>{const a=seed(i+90)*6.28+time*.2*motion;const x=100+Math.cos(a)*(64+seed(i+2)*15);const y=143+Math.sin(a*1.3)*57;n.setAttribute('transform',`translate(${x} ${y}) rotate(${a*57}) scale(${.35+seed(i+30)*.3})`);n.setAttribute('opacity','.7');});
      paintFace();
    }
    function schedule(){if(!raf&&!paused&&visible&&!destroyed&&!document.hidden&&options.autoplay!==false)raf=requestAnimationFrame(frame);}
    function frame(now){raf=0;if(paused||!visible||destroyed)return;update(last===null?0:(now-last)/1000);last=now;schedule();}
    function setSize(height){height=Number(height);if(!Number.isFinite(height)||height<=0)throw new RangeError('height must be positive CSS pixels');size=height;wrap.style.height=height+'px';wrap.style.width=height/2+'px';}
    const io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=null;if(visible)schedule();else{cancelAnimationFrame(raf);raf=0;}}):null;
    io?.observe(wrap);
    function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{last=null;schedule();}}
    document.addEventListener('visibilitychange',visibility);
    function motionChange(){update(0);}reduced.addEventListener('change',motionChange);
    setSize(options.size || 360);holdUntil=autoExpressions?4:Infinity;update(0);schedule();
    const api={
      element:wrap, renderer:'svg-2d', expressions:[...names],
      setSize,
      setExpression(name,seconds=4){if(!names.includes(name))throw new RangeError('Unknown expression: '+name);expression=name;holdUntil=seconds===Infinity?Infinity:time+Math.max(0,Number(seconds)||0);paintFace();},
      lookAt(clientX,clientY){if(Number.isFinite(clientX)&&Number.isFinite(clientY))clientPoint={x:clientX,y:clientY};},
      setGaze(x,y){clientPoint=null;target={x:clamp(Number(x)||0,-1,1),y:clamp(Number(y)||0,-1,1)};},
      clearGaze(){clientPoint=null;target={x:0,y:0};},
      wave(){gesture='wave';gestureEnd=time+2;api.setExpression('happy',2);},
      celebrate(){gesture='dance';gestureEnd=time+3;api.setExpression('excited',3);},
      update,
      pause(){paused=true;cancelAnimationFrame(raf);raf=0;last=null;},
      resume(){if(destroyed)return;paused=false;last=null;schedule();},
      getState(){return{expression,size,gesture,gaze:{...gaze},renderer:'svg-2d',paused,destroyed};},
      destroy(){if(destroyed)return;destroyed=true;cancelAnimationFrame(raf);io?.disconnect();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motionChange);if(hit)hit.removeEventListener('click',activate);wrap.remove();}
    };
    return api;
  }
  global.createNeo2D=createNeo2D;
})(typeof window!=='undefined'?window:globalThis);

const StudioPreferences = (() => {
  const read=(key,fallback)=>{try{return localStorage.getItem('openplay.'+key)||fallback;}catch{return fallback;}};
  const write=(key,value)=>{try{localStorage.setItem('openplay.'+key,value);}catch{/* Session preferences still work. */}};
  let theme=read('theme',matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  if(!['light','dark'].includes(theme))theme='dark';
  document.documentElement.dataset.theme=theme;
  function applyEditor(){if(typeof monaco!=='undefined')monaco.editor.setTheme(theme==='light'?'openplay-light':'openplay');}
  function setTheme(value){
    theme=value;document.documentElement.dataset.theme=value;write('theme',value);applyEditor();
    const toggle=document.getElementById('theme-toggle');if(toggle){toggle.textContent=theme==='dark'?'☀ Светлая':'☾ Тёмная';toggle.setAttribute('aria-label',theme==='dark'?'Включить светлую тему':'Включить тёмную тему');}
    dispatchEvent(new CustomEvent('studio-theme',{detail:value}));
  }
  function collapseLogs(value){
    const panel=document.getElementById('journal'),button=document.getElementById('log-toggle');
    panel.classList.toggle('collapsed',value);document.getElementById('logs').hidden=value;
    button.setAttribute('aria-expanded',String(!value));document.getElementById('log-chevron').textContent=value?'▸':'▾';
    write('logs-collapsed',String(value));dispatchEvent(new Event('resize'));
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('theme-toggle').onclick=()=>setTheme(theme==='dark'?'light':'dark');setTheme(theme);
    document.getElementById('log-toggle').onclick=()=>collapseLogs(!document.getElementById('journal').classList.contains('collapsed'));
    collapseLogs(read('logs-collapsed','false')==='true');
  });
  return {get theme(){return theme;},setTheme,applyEditor,collapseLogs};
})();

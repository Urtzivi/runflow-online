(()=>{
  'use strict';
  // Dictado en el propio móvil, reutilizable: el texto lo genera el teléfono, sin coste para RunFlow.
  // En la APK usa el reconocimiento nativo (plugin SpeechRecognition); en el navegador, la Web Speech API;
  // si no hay ninguno, pide usar el micrófono del teclado. Misma lógica que el dictado del feedback de running.
  if(window.RunFlowDictation)return;
  const MAX_SECONDS=120;

  function nativePlugin(){
    const cap=window.Capacitor;
    return cap?.isNativePlatform?.()&&cap.isPluginAvailable?.('SpeechRecognition')?cap.Plugins.SpeechRecognition:null;
  }
  function webSpeech(){return window.SpeechRecognition||window.webkitSpeechRecognition||null;}
  const KEYBOARD='Usa el micrófono del teclado del móvil para dictar.';

  // options: { getText():string, setText(text), onState({recording, message}), lang }
  function start(options){
    const lang=options.lang||'es-ES';
    const base=String(options.getText()||'').trim();
    const state=message=>options.onState({recording:!session.done&&session.running,message});
    const session={finalText:'',interimText:'',failure:'',heard:false,done:false,running:false,cancelled:false,cleanup:[],stopImpl:()=>{},abortImpl:()=>{},timer:null};
    session.render=()=>{
      const spoken=`${session.finalText}${session.interimText}`.replace(/\s+/g,' ').trim();
      options.setText([base,spoken].filter(Boolean).join(base&&spoken?'\n\n':''));
      return spoken;
    };
    session.finish=()=>{
      if(session.done)return;
      session.done=true;session.running=false;
      if(session.timer)clearInterval(session.timer);
      session.cleanup.forEach(fn=>{try{fn();}catch{}});
      if(session.cancelled){options.onState({recording:false,message:''});return;}
      const spoken=session.render();
      options.onState({recording:false,message:spoken?'Dictado listo. Revísalo antes de guardar.':session.failure||(session.heard?'No se ha detectado voz. Prueba otra vez.':`Tu móvil no ha devuelto texto. ${KEYBOARD}`)});
    };
    // Parar siempre libera el botón: algunos móviles no avisan del final del dictado.
    session.stop=()=>{
      if(session.done)return;
      if(session.timer)clearInterval(session.timer);
      options.onState({recording:true,message:'Terminando el dictado…'});
      try{session.stopImpl();}catch{}
      setTimeout(()=>{if(!session.done){try{session.abortImpl();}catch{}session.finish();}},1200);
    };
    session.cancel=()=>{session.cancelled=true;try{session.abortImpl();}catch{}session.finish();};
    const run=()=>{
      session.running=true;
      const startedAt=Date.now();
      const tick=()=>{
        if(session.done)return;
        const elapsed=Math.min(MAX_SECONDS,Math.floor((Date.now()-startedAt)/1000));
        state(`Escuchando… ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')} / 2:00. Habla y verás el texto.`);
        if(elapsed>=6&&!session.heard){try{session.abortImpl();}catch{}session.failure=`Tu móvil no permite dictar desde RunFlow. ${KEYBOARD}`;session.finish();return;}
        if(elapsed>=MAX_SECONDS)session.stop();
      };
      tick();session.timer=setInterval(tick,1000);
    };

    const plugin=nativePlugin();
    if(plugin){
      (async()=>{
        try{
          const {available}=await plugin.available();
          if(!available){session.failure=`Tu móvil no tiene reconocimiento de voz. ${KEYBOARD}`;return session.finish();}
          let permission=await plugin.checkPermissions();
          if(permission.speechRecognition!=='granted')permission=await plugin.requestPermissions();
          if(permission.speechRecognition!=='granted'){session.failure=`Necesitamos permiso para usar el micrófono. Mientras, ${KEYBOARD.toLowerCase()}`;return session.finish();}
        }catch{session.failure=`No se pudo dictar. ${KEYBOARD}`;return session.finish();}
        session.stopImpl=session.abortImpl=()=>plugin.stop().catch(()=>{});
        const partial=await plugin.addListener('partialResults',data=>{if(session.done)return;session.heard=true;session.interimText=data?.matches?.[0]||session.interimText;session.render();});
        const listening=await plugin.addListener('listeningState',data=>{if(data?.status==='started')session.heard=true;if(data?.status==='stopped')setTimeout(()=>session.finish(),700);});
        session.cleanup.push(()=>partial.remove(),()=>listening.remove());
        run();
        plugin.start({language:lang,partialResults:true,popup:false}).catch(()=>{session.failure=`No se pudo dictar. ${KEYBOARD}`;session.finish();});
      })();
      return session;
    }
    const Recognition=webSpeech();
    if(!Recognition){session.failure=`Este navegador no dicta desde RunFlow. ${KEYBOARD}`;session.heard=true;session.finish();return session;}
    const recognition=new Recognition();
    session.stopImpl=()=>recognition.stop();session.abortImpl=()=>recognition.abort();
    recognition.lang=lang;recognition.continuous=true;recognition.interimResults=true;
    recognition.onaudiostart=()=>{session.heard=true;};
    recognition.onresult=event=>{
      session.heard=true;session.interimText='';
      for(let i=event.resultIndex;i<event.results.length;i++){
        const text=event.results[i][0]?.transcript||'';
        if(event.results[i].isFinal)session.finalText+=`${text} `;else session.interimText+=text;
      }
      session.render();
    };
    recognition.onerror=event=>{
      session.failure=event.error==='not-allowed'||event.error==='service-not-allowed'?`Necesitamos permiso para usar el micrófono. Mientras, ${KEYBOARD.toLowerCase()}`:event.error==='no-speech'?'No se ha detectado voz. Prueba otra vez.':event.error==='aborted'?'':`No se pudo dictar. ${KEYBOARD}`;
    };
    recognition.onend=()=>session.finish();
    try{recognition.start();}catch{session.failure=`No se pudo dictar. ${KEYBOARD}`;session.heard=true;session.finish();return session;}
    run();
    return session;
  }

  window.RunFlowDictation={start,isSupported:()=>Boolean(nativePlugin()||webSpeech())};
})();

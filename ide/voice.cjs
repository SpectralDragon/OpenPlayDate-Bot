async function transcribe(bytes, key, fetcher=fetch) {
  if(!key)throw new Error('Добавь OpenAI API-ключ для голоса в настройках агента. Текстовый ввод уже доступен.');
  if(!(bytes instanceof Uint8Array)||bytes.length<100||bytes.length>8*1024*1024)throw new Error('Запись должна быть до 8 МиБ');
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:'audio/webm'}),'voice.webm');
  form.append('model','gpt-4o-mini-transcribe');form.append('language','ru');
  form.append('prompt','Речь об играх, героях, прыжках, монетках, Lua и консоли OpenPlay.');
  const response=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(response.status===401?'API-ключ для голоса не принят. Проверь настройки.':response.status===429?'Лимит распознавания речи исчерпан. Проверь лимиты OpenAI API.':`Не удалось распознать речь (HTTP ${response.status})`);
  const result=await response.json();
  if(typeof result.text!=='string'||result.text.length>10000)throw new Error('Не удалось получить текст записи');
  return result.text.trim();
}
module.exports={transcribe};

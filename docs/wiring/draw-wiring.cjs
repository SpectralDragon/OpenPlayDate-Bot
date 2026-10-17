const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/Vladislav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const out = __dirname;
const parts = [];
const c = {ink:'#202733',muted:'#566174',ground:'#252a32',p33:'#d93b53',p5:'#a12436',x:'#16845c',y:'#2374cc',sw:'#cf781a',a:'#8050bb',b:'#b34891',cs:'#ce7617',rst:'#856043',dc:'#8253bd',mosi:'#128568',clk:'#2878c7',board:'#eee8f8'};
function rect(x,y,w,h,fill,stroke='#d6dce5',r=14){parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`)}
function text(x,y,s,size=25,color=c.ink,weight=400,anchor='start'){parts.push(`<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`)}
function line(x1,y1,x2,y2,color,width=5){parts.push(`<path d="M${x1} ${y1} H${x2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`)}
function pathline(d,color,width=4){parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`)}
function dot(x,y,color,r=7){parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="white" stroke="${color}" stroke-width="4"/>`)}
function wire(x1,x2,y,color){line(x1,y,x2,y,color);dot(x1,y,color);dot(x2,y,color)}
parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="1430" viewBox="0 0 1900 1430" role="img" aria-label="Схема подключения AI-S3, экрана SPI, джойстика и двух кнопок">');
rect(0,0,1900,1430,'#f7f8fb','#f7f8fb',0);
text(60,68,'Первый пульт робота',43,c.ink,600);
text(60,110,'AI-S3 / ESP32-S3-WROOM-1 N16R8 • экран SPI 240×320 • джойстик • две кнопки',26,c.muted);
text(60,151,'Контакты расположены условно. Подключай по надписям на платах, а не по месту на рисунке.',23,c.muted);

// Controller: functional grouping, not a physical pinout.
rect(700,190,470,935,c.board,'#a78cc5',22);
rect(821,219,228,55,'#444353','#444353',5);
text(935,255,'АНТЕННА',20,'#ffffff',500,'middle');
text(935,310,'AI-S3',37,c.ink,600,'middle');
text(935,346,'ESP32-S3',23,c.muted,400,'middle');
text(935,378,'N16R8',22,c.muted,400,'middle');

// Joystick: same five label order as photograph.
rect(60,205,365,410,'#ffffff');
text(85,247,'ДЖОЙСТИК',28,c.ink,600);
parts.push('<circle cx="150" cy="379" r="62" fill="#303744"/><circle cx="140" cy="365" r="33" fill="#454f60"/>');
const joy = [
 [300,'GND','GND',c.ground],
 [360,'+5V','3V3',c.p33],
 [420,'VRx','GPIO 4',c.x],
 [480,'VRy','GPIO 5',c.y],
 [540,'SW','GPIO 6',c.sw],
];
for(const [y,a,b,color] of joy){text(397,y-13,a,25,c.ink,500,'end');wire(425,700,y,color);text(719,y+8,b,25,c.ink,500);}
text(85,585,'Контакт «+5V» питаем от 3V3!',21,c.p33,600);

// Button symbols show two electrical nodes, independent of leg orientation.
function button(y,title,gpio,color){
 rect(60,y-65,365,185,'#ffffff');text(85,y-23,title,27,c.ink,600);
 const sy=y+20, gy=y+80;
 pathline(`M425 ${sy} H310 V${sy+15}`,color);
 pathline(`M425 ${gy} H310 V${gy-15}`,c.ground);
 dot(310,sy+15,color,5);dot(310,gy-15,c.ground,5);
 pathline(`M310 ${sy+15} L285 ${gy-20}`,c.ink,4);
 text(85,y+35,'Нажатие',21,c.muted);
 text(85,y+65,'замыкает',21,c.muted);
 wire(425,700,sy,color);wire(425,700,gy,c.ground);
 text(719,sy+8,`GPIO ${gpio}`,25,c.ink,500);text(719,gy+8,'GND',25,c.ink,500);
}
button(705,'КНОПКА A',7,c.a);
button(930,'КНОПКА B',15,c.b);
text(935,1051,'6, 7, 15: INPUT_PULLUP',22,c.ink,500,'middle');
text(935,1085,'Нажато = 0',21,c.muted,400,'middle');

// Display labels correspond to the user's rear PCB silkscreen.
rect(1430,205,410,640,'#fff4f1','#e4c0b7');
text(1455,247,'ЭКРАН SPI',28,c.ink,600);
const lcd = [
 [300,'VCC','5Vin*',c.p5],
 [360,'GND','GND',c.ground],
 [420,'CS','GPIO 10',c.cs],
 [480,'RESET','GPIO 14',c.rst],
 [540,'DC','GPIO 9',c.dc],
 [600,'SDI (MOSI)','GPIO 11',c.mosi],
 [660,'SCK','GPIO 12',c.clk],
 [720,'LED','3V3',c.p33]
];
for(const [y,a,b,color] of lcd){text(1151,y-13,b,25,c.ink,500,'end');wire(1170,1430,y,color);text(1452,y+8,a,25,c.ink,500);}
rect(1673,305,137,227,'#263944','#263944',5);
parts.push('<ellipse cx="1710" cy="405" rx="13" ry="26" fill="#cbece8"/><ellipse cx="1770" cy="405" rx="13" ry="26" fill="#cbece8"/>');
text(1742,478,'240×320',17,'#ffffff',400,'middle');
text(1455,778,'J1 оставить разомкнутой.',22,c.p5,600);
text(1455,814,'LED — постоянная подсветка.',21,c.muted);

// Connections deliberately omitted for the first build.
text(1230,906,'ПОКА ОСТАВИТЬ СВОБОДНЫМИ',24,c.ink,600);
text(1230,948,'Экран: SDO (MISO), T_CLK, T_CS,',23,c.muted);
text(1230,981,'T_DIN, T_DO, T_IRQ и все SD_*.',23,c.muted);
text(1230,1035,'На фото U1 для тача не установлена.',22,c.muted);
text(1230,1073,'Профиль ST7789, 240×320, BGR, инверсия выкл.',22,c.muted);
text(1230,1107,'*5Vin: выход от USB требует проверки IN-OUT.',20,c.p5,600);
text(1230,1135,'До подключения VCC измерь около 5 В! См. README.',20,c.p5,600);

// Ground/power labels are repeated electrical nets, not extra board pins.
rect(60,1164,1780,210,'#ffffff');
text(88,1205,'ПЕРЕД ПОДКЛЮЧЕНИЕМ',25,c.ink,600);
text(88,1246,'1. Питание всей сборки — одним USB-кабелем через AI-S3. Переставляй провода при отключённом USB.',23);
text(88,1284,'2. Все GND соединены. Повторяющиеся GND и 3V3 на рисунке — общие шины макетки.',23);
text(88,1322,'3. У каждой кнопки выбери выводы из разных пар: они соединяются только при нажатии. Проверь прозвонкой.',23);
text(60,1410,'GPIO 12 означает контакт с надписью «12». GPIO35–37 заняты PSRAM. На сигнальные выводы ESP32 не подавать 5 В.',22,c.muted);
parts.push('</svg>');
const svg=parts.join('\n');
fs.writeFileSync(path.join(out,'ai-s3-wiring.svg'),svg,'utf8');
sharp(Buffer.from(svg)).png().toFile(path.join(out,'ai-s3-wiring.png')).then(()=>console.log('Created ai-s3-wiring.svg and ai-s3-wiring.png'));

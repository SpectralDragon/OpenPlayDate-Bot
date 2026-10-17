const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
// A framed stdout protocol avoids mixing framebuffer bytes and Lua logs.
class Simulator extends EventEmitter {
  constructor(executable, storage, name, fps) {
    super(); this.buffer = Buffer.alloc(0); this.pending = false; this.paused = false; this.mask = 0; this.started = Date.now(); this.lastReply = Date.now(); this.lastTime = 0; this.frameMs = Math.ceil(1000 / fps);
    this.child = spawn(executable, [storage, name], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', bytes => this.receive(bytes));
    this.child.stderr.on('data', bytes => this.emit('event', { type: 'log', message: bytes.toString() }));
    this.child.on('error', e => this.emit('event', { type: 'error', message: e.message }));
    this.child.stdin.on('error', () => {});
    this.child.on('exit', (code) => {
      clearInterval(this.timer); this.closed = true;
      if (code && !this.reportedError) this.emit('event', { type: 'error', message: `Симулятор завершился с кодом ${code}` });
      this.emit('event', { type: 'closed' });
    });
    this.timer = setInterval(() => {
      if (Date.now() - this.lastReply > 3000 && !this.paused) {
        this.emit('event', { type: 'error', message: 'Симулятор не ответил за 3 секунды' }); this.stop(); return;
      }
      if (this.ready && !this.pending && !this.paused) this.frame();
    }, Math.ceil(1000 / fps));
  }
  receive(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    while (this.buffer.length >= 5) {
      const type = this.buffer[0], size = this.buffer.readUInt32LE(1);
      if (size > 512 * 1024) { this.emit('event', { type: 'error', message: 'Неверный ответ симулятора' }); this.stop(); return; }
      if (this.buffer.length < size + 5) return;
      const payload = this.buffer.subarray(5, size + 5); this.buffer = this.buffer.subarray(size + 5);
      this.lastReply = Date.now();
      if (type === 70) { this.pending = false; this.emit('frame', payload); }
      else if (type === 74) {
        try {
          const event = JSON.parse(payload.toString());
          if (event.type === 'ready') this.ready = true;
          if (event.type === 'error') this.reportedError = true;
          this.emit('event', event);
        } catch { this.emit('event', { type: 'error', message: 'Ошибка протокола симулятора' }); this.stop(); }
      }
    }
  }
  command(line) { if (!this.closed && !this.child.stdin.destroyed) this.child.stdin.write(line + '\n'); }
  now() { return this.lastTime = Math.max(this.lastTime, Date.now() - this.started); }
  frame() { this.pending = true; this.command(`frame ${this.now()} ${this.mask}`); }
  input(mask) { this.mask = mask & 127; if (this.ready && !this.paused) this.command(`input ${this.now()} ${this.mask}`); }
  pause() { this.paused = true; this.mask = 0; this.command('pause'); }
  resume() { this.paused = false; this.lastReply = Date.now(); this.command('resume'); }
  step() { if (this.paused && !this.pending) { this.lastTime = this.now() + this.frameMs; this.command('resume'); this.frame(); this.command('pause'); } }
  stop() { clearInterval(this.timer); this.command('stop'); const child = this.child; const killer = setTimeout(() => child.kill(), 300); killer.unref(); }
}
module.exports = { Simulator };

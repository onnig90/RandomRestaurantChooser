/**
 * wheel.js - Specialized Wheel Drawing and Animation
 * Integrated from user-provided spec.
 */

const PAL = [
  {bg:'#2C2010',rim:'#E8C547',label:'#E8C547'},
  {bg:'#251515',rim:'#E85858',label:'#F08080'},
  {bg:'#152115',rim:'#4DD980',label:'#80EAA8'},
  {bg:'#141A28',rim:'#5B9EF0',label:'#8EC0FF'},
  {bg:'#1E1630',rim:'#9B6EE8',label:'#C4A0FF'},
  {bg:'#251A10',rim:'#E88040',label:'#F0A870'},
  {bg:'#102020',rim:'#40D4D4',label:'#80E8E8'},
  {bg:'#201E10',rim:'#C8C040',label:'#E0DA80'},
  {bg:'#1A1025',rim:'#D060C8',label:'#E890E4'},
  {bg:'#102018',rim:'#40C890',label:'#80E4C0'},
];

const cv = document.getElementById('wheel');
const ctx = cv.getContext('2d');
const CX = 300, CY = 300, R = 292;

let angle = 0;
let winnerIndex = -1;
let spinning = false;

function drawWheel(a) {
  if (!ctx) return;
  const items = window.ITEMS || [];
  ctx.clearRect(0, 0, 600, 600);
  
  if (items.length === 0) {
      // Draw empty darker circle
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
      ctx.fillStyle = '#101010'; ctx.fill();
      ctx.fillStyle = '#333';
      ctx.font = '20px DM Sans';
      ctx.textAlign = 'center';
      ctx.fillText('No restaurants found', CX, CY);
      return;
  }

  const n = items.length;
  const step = (2 * Math.PI) / n;

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = '#101010'; ctx.fill();

  items.forEach((item, i) => {
    const p = PAL[i % PAL.length];
    const isWin = i === winnerIndex && !spinning;
    const sa = a + i * step - Math.PI / 2;
    const ea = sa + step;
    const mid = sa + step / 2;

    const gx = CX + Math.cos(mid) * R * .55;
    const gy = CY + Math.sin(mid) * R * .55;
    const grad = ctx.createRadialGradient(CX, CY, 0, gx, gy, R);
    grad.addColorStop(0, isWin ? p.rim + '22' : '#161616');
    grad.addColorStop(1, isWin ? p.bg + 'EE' : p.bg);

    ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R - 1, sa, ea); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(sa) * R, CY + Math.sin(sa) * R);
    ctx.strokeStyle = '#0D0D0D'; ctx.lineWidth = 1.8; ctx.stroke();

    if (isWin) {
      ctx.beginPath(); ctx.arc(CX, CY, R - 1, sa, ea);
      ctx.strokeStyle = p.rim + '28'; ctx.lineWidth = 18; ctx.stroke();
    }

    ctx.beginPath(); ctx.arc(CX, CY, R - 1, sa, ea);
    ctx.strokeStyle = isWin ? p.rim : p.rim + '55';
    ctx.lineWidth = isWin ? 5 : 2.5; ctx.stroke();

    ctx.save();
    ctx.translate(CX, CY); ctx.rotate(mid);
    ctx.beginPath(); ctx.arc(R - 22, 0, isWin ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isWin ? p.rim : p.rim + '90'; ctx.fill();
    
    const name = typeof item === 'string' ? item : item.name;
    const lbl = name.length > 14 ? name.slice(0, 13) + '…' : name;
    ctx.font = `${isWin ? 600 : 400} 12px 'DM Sans',sans-serif`;
    ctx.fillStyle = isWin ? p.rim : p.label;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, R - 34, 0);
    ctx.restore();
  });

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1.5; ctx.stroke();

  for (let t = 0; t < 48; t++) {
    const ta = (t / 48) * Math.PI * 2, maj = t % 12 === 0;
    const r0 = R + 3, r1 = r0 + (maj ? 8 : 4);
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(ta) * r0, CY + Math.sin(ta) * r0);
    ctx.lineTo(CX + Math.cos(ta) * r1, CY + Math.sin(ta) * r1);
    ctx.strokeStyle = maj ? 'rgba(232,197,71,.35)' : 'rgba(255,255,255,.07)';
    ctx.lineWidth = maj ? 2 : 1; ctx.stroke();
  }

  const hg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 26);
  const lit = winnerIndex >= 0 && !spinning;
  hg.addColorStop(0,  lit ? '#E8C547' : '#2a2a2a');
  hg.addColorStop(.6, lit ? '#c9a63a' : '#1a1a1a');
  hg.addColorStop(1, '#111');
  ctx.beginPath(); ctx.arc(CX, CY, 26, 0, Math.PI * 2);
  ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = lit ? 'rgba(232,197,71,.6)' : 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = `${lit ? 'bold ' : ''}15px sans-serif`;
  ctx.fillStyle = lit ? '#0D0D0D' : 'rgba(255,255,255,.18)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('✦', CX, CY + 1);
}

window.spin = function() {
  return new Promise((resolve) => {
    if (spinning || !window.ITEMS || window.ITEMS.length === 0) {
        resolve(null);
        return;
    }
    
    spinning = true;
    winnerIndex = -1;
    document.getElementById('result-text').classList.remove('show');
    document.getElementById('glow').classList.remove('lit');

    const n = window.ITEMS.length;
    const step = (2 * Math.PI) / n;

    const landPos = Math.random() * 2 * Math.PI;
    const target = Math.floor(landPos / step) % n;

    const targetNorm = ((-landPos) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const curNorm = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    let delta = targetNorm - curNorm;
    if (delta <= 0) delta += 2 * Math.PI;
    delta += (8 + Math.floor(Math.random() * 10)) * 2 * Math.PI;

    const dur = 4500 + Math.random() * 2500;
    const ease = t => 1 - Math.pow(1 - t, 3);

    const t0 = performance.now();
    const startAngle = angle;
    let prevSegCount = 0;

    (function frame(now) {
      const t = Math.min((now - t0) / dur, 1);
      angle = startAngle + delta * ease(t);

      const segCount = Math.floor((angle - startAngle) / step);
      if (segCount > prevSegCount) {
        tick();
        prevSegCount = segCount;
      }

      drawWheel(angle);

      if (t < 1) { requestAnimationFrame(frame); return; }

      winnerIndex = target;
      spinning = false;
      
      const winner = window.ITEMS[target];
      document.getElementById('result-text').textContent = '🎉 ' + (typeof winner === 'string' ? winner : winner.name);
      document.getElementById('result-text').classList.add('show');
      document.getElementById('glow').classList.add('lit');
      
      drawWheel(angle);
      
      if (window.confetti) {
          window.confetti({
            particleCount: 180, spread: 110, origin: { y: .35 },
            colors: ['#E8C547','#E87D47','#E84747','#47C97B','#5B9EF0','#9B6EE8']
          });
      }
      
      resolve(winner);
    })(t0);
  });
}

function tick() {
  const p = document.getElementById('pointer');
  if (!p) return;
  p.style.filter = 'drop-shadow(0 0 20px #fff) drop-shadow(0 0 6px var(--accent-gold))';
  setTimeout(() => { p.style.filter = 'drop-shadow(0 0 10px var(--accent-gold))'; }, 55);
}

// Global expose to draw
window.drawPlaceholderWheel = () => drawWheel(angle);

// Initial draw
setTimeout(() => {
    drawWheel(angle);
}, 200);

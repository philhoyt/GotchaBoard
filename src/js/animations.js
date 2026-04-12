'use strict';

export const SPRING_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const EASE_OUT      = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export function springIn(el, fromScale = 0.8, duration = 280) {
  return el.animate([
    { transform: `scale(${fromScale})`, opacity: 0.6 },
    { transform: 'scale(1)',            opacity: 1   }
  ], { duration, easing: SPRING_EASING, fill: 'forwards' });
}

export function springOut(el, toScale = 0.8, duration = 200) {
  return el.animate([
    { transform: 'scale(1)',          opacity: 1 },
    { transform: `scale(${toScale})`, opacity: 0 }
  ], { duration, easing: EASE_OUT, fill: 'forwards' });
}

export function flyTo(el, targetX, targetY, rotation = 0, duration = 350) {
  const rect = el.getBoundingClientRect();
  const dx = targetX - (rect.left + rect.width  / 2);
  const dy = targetY - (rect.top  + rect.height / 2);

  return el.animate([
    { transform: `translate(0, 0) rotate(0deg) scale(1)`,                                                                offset: 0    },
    { transform: `translate(${dx * 1.08}px, ${dy * 1.08}px) rotate(${rotation * 1.3}deg) scale(0.9)`,                   offset: 0.75 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${rotation}deg) scale(1)`,                                          offset: 1    }
  ], { duration, easing: EASE_OUT, fill: 'forwards' });
}

export function burst(el, angle, distance = 80, duration = 450) {
  const rad = (angle * Math.PI) / 180;
  const bx  = Math.cos(rad) * distance;
  const by  = Math.sin(rad) * distance;
  const rot = (Math.random() - 0.5) * 60;

  el.style.setProperty('--burst-x',   `${bx}px`);
  el.style.setProperty('--burst-y',   `${by}px`);
  el.style.setProperty('--burst-rot', `${rot}deg`);

  return el.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)',                                                   opacity: 1,   offset: 0   },
    { transform: `translate(${bx}px,${by}px) scale(1.1) rotate(${rot}deg)`,                               opacity: 0.9, offset: 0.5 },
    { transform: `translate(${bx * 1.4}px,${by * 1.4}px) scale(0) rotate(${rot * 1.5}deg)`,              opacity: 0,   offset: 1   }
  ], { duration, easing: EASE_OUT, fill: 'forwards' });
}

export function shake(el, duration = 480) {
  return el.animate([
    { transform: 'translateX(0)',                    offset: 0    },
    { transform: 'translateX(-12px) rotate(-3deg)',  offset: 0.15 },
    { transform: 'translateX(12px) rotate(3deg)',    offset: 0.30 },
    { transform: 'translateX(-9px) rotate(-2deg)',   offset: 0.45 },
    { transform: 'translateX(9px) rotate(2deg)',     offset: 0.60 },
    { transform: 'translateX(-5px)',                 offset: 0.75 },
    { transform: 'translateX(5px)',                  offset: 0.90 },
    { transform: 'translateX(0)',                    offset: 1    }
  ], { duration, easing: 'ease-in-out', fill: 'forwards' });
}

export function tagReceive(el, duration = 400) {
  const orig = el.style.background;
  return el.animate([
    { transform: 'scale(1)',    background: '',               offset: 0    },
    { transform: 'scale(1.3)', background: 'var(--primary)', offset: 0.25 },
    { transform: 'scale(0.95)', background: 'var(--primary)', offset: 0.55 },
    { transform: 'scale(1)',    background: orig,             offset: 1    }
  ], { duration, easing: SPRING_EASING, fill: 'none' });
}

export function floatBob(el) {
  return el.animate([
    { transform: `translateY(0px) rotate(var(--stack-rot, 0deg))`  },
    { transform: `translateY(-5px) rotate(var(--stack-rot, 0deg))` }
  ], { duration: 1200, easing: 'ease-in-out', iterations: Infinity, direction: 'alternate' });
}

export function sweep(el, delay = 0, duration = 350) {
  return el.animate([
    { transform: 'translateX(0) rotate(0deg)',     opacity: 1, offset: 0 },
    { transform: 'translateX(60vw) rotate(15deg)', opacity: 0, offset: 1 }
  ], { duration, delay, easing: EASE_OUT, fill: 'forwards' });
}

export const Animations = {
  springIn, springOut, flyTo, burst, shake, tagReceive, floatBob, sweep, SPRING_EASING
};

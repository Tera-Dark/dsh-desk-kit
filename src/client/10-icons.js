   // ---------------------------------------------------------------- 图标(Lucide 风格, stroke)
   const PATHS = {
     bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
     note: ['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 12h7', 'M9 16h5'],
     home: ['M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'],
     lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 1 1 6 0v3'],
     gear: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
     link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
     copy: ['M9 9h10v10H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
     edit: ['M4 20h4L19 9a2 2 0 0 0-3-3L5 17z'],
     x: ['M6 6l12 12', 'M18 6L6 18'],
     pin: ['M12 17v5', 'M9 3h6l-1 6 3 3v2H7v-2l3-3z'],
     check: ['M4 12l5 5L20 6'],
     clipboard: ['M9 4h6v3H9z', 'M8 5H6v16h12V5h-2'],
     plus: ['M12 5v14', 'M5 12h14'],
     send: ['M12 19V5', 'M5 12l7-7 7 7'],
     chevronLeft: ['M15 5l-7 7 7 7'],
     chevronUp: ['M6 15l6-6 6 6'],
     chevronDown: ['M6 9l6 6 6-6'],
     menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
     undo: ['M9 14L4 9l5-5', 'M4 9h9a7 7 0 0 1 0 14H8'],
     trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
     clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7v5l3.5 2'],
     swap: ['M4 8h13', 'M14 5l3 3-3 3', 'M20 16H7', 'M10 19l-3-3 3-3'],
     pause: ['M9 5v14', 'M15 5v14'],
     play: ['M8 5l11 7-11 7z'],
     download: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 20h14'],
     grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
     globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3'],
     image: ['M4 5h16v14H4z', 'M4 15l4.5-4.5 4 4 3-3L20 15', 'M8.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2'],
     search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'M21 21l-4.3-4.3'],
   }
   function Ico({ name, size, className }) {
     const paths = PATHS[name] || []
     return h('svg', {
       className, width: size || 20, height: size || 20, viewBox: '0 0 24 24', fill: 'none',
       stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
       'aria-hidden': 'true',
     }, paths.map((d, i) => h('path', { key: i, d })))
   }

   /**
    * 到点提示音。
    * 两声上行(A5 → E6)加 6ms 起音、0.55s 指数衰减,低通 6.2kHz 削掉数字味 ——
    * 走路听见会回头,戴耳机不炸耳。用 Web Audio 现场合成,不打包 mp3:
    * 体积为零、没有版权问题、音量随系统走。
    */
   const SOUND = { notes: [880, 1318.51], gap: 0.10, attack: 0.006, decay: 0.55, gain: 0.08, cutoff: 6200 }
   let audioCtx = null

   function playChime() {
     try {
       const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
       if (!AC) return false
       if (!audioCtx) audioCtx = new AC()
       // 浏览器要一次用户手势才允许出声;点过面板之后就一直可用
       if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') audioCtx.resume()
       const t0 = audioCtx.currentTime + 0.01
       const filter = audioCtx.createBiquadFilter()
       filter.type = 'lowpass'
       filter.frequency.value = SOUND.cutoff
       filter.connect(audioCtx.destination)
       SOUND.notes.forEach((freq, i) => {
         const start = t0 + i * SOUND.gap
         const osc = audioCtx.createOscillator()
         const gain = audioCtx.createGain()
         osc.type = 'triangle'          // 三角波:比正弦有存在感,比锯齿干净
         osc.frequency.value = freq
         gain.gain.setValueAtTime(0.0001, start)
         gain.gain.exponentialRampToValueAtTime(SOUND.gain, start + SOUND.attack)
         gain.gain.exponentialRampToValueAtTime(0.0001, start + SOUND.decay)
         osc.connect(gain)
         gain.connect(filter)
         osc.start(start)
         osc.stop(start + SOUND.decay + 0.02)
       })
       return true
     } catch { return false }
   }

   /**
    * 新告警出现时响一声。
    * 只在「多出来一条」时响:打开面板时已经躺在列表里的旧提醒不吵人;
    * 一次轮询回来三条也只响一下。
    */
   function useAlertSound(settings, alerts) {
     const heard = useRef('')
     useEffect(() => {
       const key = (alerts || []).map((a) => a.id).join(',')
       if (!key) { heard.current = ''; return }
       if (heard.current === key) return
       const first = heard.current === ''
       heard.current = key
       const st0 = settings || {}
       if (first) {
         // 打开面板时旧提醒一般不吵;但「DSH 关着时错过的」要响一声,否则等于没提醒
         if ((alerts || []).some((a) => a.late) && !st0.muted && st0.sound !== false) playChime()
         return
       }
       const st = settings || {}
       if (st.muted || st.sound === false) return
       playChime()
     }, [settings, alerts])
   }


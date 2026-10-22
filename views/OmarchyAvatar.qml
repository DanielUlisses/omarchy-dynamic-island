import QtQuick

// The island's companion: a small procedural face drawn on a Canvas, after
// the Omarchy mark's geometry (a heavy ring of square-cut segments around a
// rounded block), with two eyes that follow your pointer.
//
// It is coloured from the theme, and its glow takes on the colour of whatever
// agent is busy (Claude terracotta, Codex green, Pi cyan, ...). Its moods:
//   idle      breathes slowly, blinks now and then
//   working   the ring turns and its segments light up in sequence
//   approval  bounces, amber, eyes wide: something is waiting on you
//   music     bobs to the beat while media plays
//   poked     a spin and a glitch when clicked
Item {
  id: avatar

  property string mood: "idle"
  property color base: "#e0e0e0"
  property color accent: "#7aa2f7"
  property color glow: accent
  property color alert: "#e0af68"
  // -1..1: where the pointer is, relative to the avatar.
  property real lookX: 0
  property real lookY: 0

  signal poked()

  implicitWidth: 22
  implicitHeight: 22

  // ---- animated values the Canvas draws from
  property real breath: 0
  property real spin: 0
  property real chase: 0
  property real blink: 1
  property real bounce: 0
  property real glitch: 0
  property real eyeX: lookX
  property real eyeY: lookY

  Behavior on eyeX { SmoothedAnimation { velocity: 3 } }
  Behavior on eyeY { SmoothedAnimation { velocity: 3 } }

  readonly property color tone: mood === "approval" ? alert : (mood === "working" ? glow : accent)

  onBreathChanged: canvas.requestPaint()
  onSpinChanged: canvas.requestPaint()
  onChaseChanged: canvas.requestPaint()
  onBlinkChanged: canvas.requestPaint()
  onGlitchChanged: canvas.requestPaint()
  onEyeXChanged: canvas.requestPaint()
  onEyeYChanged: canvas.requestPaint()
  onToneChanged: canvas.requestPaint()
  onBaseChanged: canvas.requestPaint()
  onMoodChanged: canvas.requestPaint()

  SequentialAnimation on breath {
    running: avatar.visible
    loops: Animation.Infinite
    NumberAnimation { from: 0; to: 1; duration: avatar.mood === "working" ? 900 : 2600; easing.type: Easing.InOutSine }
    NumberAnimation { from: 1; to: 0; duration: avatar.mood === "working" ? 900 : 2600; easing.type: Easing.InOutSine }
  }

  NumberAnimation on spin {
    running: avatar.visible && avatar.mood === "working"
    loops: Animation.Infinite
    from: 0; to: 360; duration: 3200
  }

  NumberAnimation on chase {
    running: avatar.visible && avatar.mood === "working"
    loops: Animation.Infinite
    from: 0; to: 8; duration: 1200
  }

  // Blink every few seconds (not while alarmed: eyes stay wide).
  Timer {
    interval: 3200 + Math.random() * 2400
    repeat: true
    running: avatar.visible && avatar.mood !== "approval"
    onTriggered: { interval = 2600 + Math.random() * 3200; blinkAnim.restart() }
  }
  SequentialAnimation {
    id: blinkAnim
    NumberAnimation { target: avatar; property: "blink"; to: 0.1; duration: 70 }
    NumberAnimation { target: avatar; property: "blink"; to: 1; duration: 110 }
  }

  // Bounce: urgent for an approval, a gentle bob for music.
  SequentialAnimation on bounce {
    running: avatar.visible && (avatar.mood === "approval" || avatar.mood === "music")
    loops: Animation.Infinite
    onRunningChanged: if (!running) avatar.bounce = 0
    NumberAnimation { to: avatar.mood === "approval" ? -0.22 : -0.1; duration: avatar.mood === "approval" ? 180 : 260; easing.type: Easing.OutQuad }
    NumberAnimation { to: 0; duration: avatar.mood === "approval" ? 260 : 300; easing.type: Easing.OutBounce }
    PauseAnimation { duration: avatar.mood === "approval" ? 380 : 140 }
  }

  // Poke: a full turn with a few frames of glitch.
  function poke() {
    pokeAnim.restart()
    poked()
  }
  ParallelAnimation {
    id: pokeAnim
    RotationAnimation { target: body; property: "rotation"; from: 0; to: 360; duration: 520; easing.type: Easing.OutBack }
    SequentialAnimation {
      NumberAnimation { target: avatar; property: "glitch"; to: 1; duration: 60 }
      NumberAnimation { target: avatar; property: "glitch"; to: -0.6; duration: 60 }
      NumberAnimation { target: avatar; property: "glitch"; to: 0.4; duration: 60 }
      NumberAnimation { target: avatar; property: "glitch"; to: 0; duration: 120 }
    }
  }

  Item {
    id: body
    width: avatar.width
    height: avatar.height
    y: avatar.bounce * avatar.height
    transformOrigin: Item.Center

    // Soft glow behind, in the tone, stronger while working or alarmed.
    Rectangle {
      anchors.centerIn: parent
      width: parent.width * (1.05 + 0.1 * avatar.breath)
      height: width
      radius: width / 2
      color: avatar.tone
      opacity: avatar.mood === "idle" || avatar.mood === "music" ? 0.05 + 0.04 * avatar.breath : 0.14 + 0.1 * avatar.breath
    }

    Canvas {
      id: canvas
      anchors.fill: parent
      antialiasing: true
      renderStrategy: Canvas.Cooperative

      onPaint: {
        var ctx = getContext("2d")
        var w = width, h = height
        ctx.reset()
        if (w <= 0 || h <= 0) return
        var s = Math.min(w, h)
        var cx = w / 2 + avatar.glitch * s * 0.06, cy = h / 2
        var tone = avatar.tone
        var base = avatar.base

        // Ring: eight square-cut segments with gaps, turning while working.
        var outer = s * (0.47 - 0.015 * (1 - avatar.breath))
        var thick = s * 0.11
        ctx.lineWidth = thick
        ctx.lineCap = "butt"
        var rot = avatar.spin * Math.PI / 180
        for (var i = 0; i < 8; i++) {
          var a0 = rot + i * Math.PI / 4 + 0.12
          var a1 = a0 + Math.PI / 4 - 0.24
          var lit = 0.35
          if (avatar.mood === "working") {
            var d = (i - avatar.chase + 8) % 8
            lit = d < 1 ? 1 : (d < 2 ? 0.7 : 0.3)
          } else if (avatar.mood === "approval") lit = 0.95
          else lit = 0.45 + 0.2 * avatar.breath
          ctx.strokeStyle = Qt.rgba(tone.r, tone.g, tone.b, lit)
          ctx.beginPath()
          ctx.arc(cx, cy, outer - thick / 2, a0, a1, false)
          ctx.stroke()
        }

        // Core: a rounded block in the theme's foreground.
        var core = s * 0.52
        var r = core * 0.3
        var x = cx - core / 2, y = cy - core / 2
        ctx.fillStyle = Qt.rgba(base.r, base.g, base.b, 0.92)
        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.lineTo(x + core - r, y)
        ctx.arcTo(x + core, y, x + core, y + r, r)
        ctx.lineTo(x + core, y + core - r)
        ctx.arcTo(x + core, y + core, x + core - r, y + core, r)
        ctx.lineTo(x + r, y + core)
        ctx.arcTo(x, y + core, x, y + core - r, r)
        ctx.lineTo(x, y + r)
        ctx.arcTo(x, y, x + r, y, r)
        ctx.closePath()
        ctx.fill()

        // Eyes: two pills that look where the pointer is.
        var wide = avatar.mood === "approval" ? 1.3 : 1
        var ew = core * 0.16 * wide
        var eh = core * 0.34 * wide * avatar.blink
        var ex = avatar.eyeX * core * 0.13
        var ey = avatar.eyeY * core * 0.1
        ctx.fillStyle = avatar.mood === "approval" ? tone : Qt.darker(tone, 1.6)
        for (var k = -1; k <= 1; k += 2) {
          var px = cx + k * core * 0.17 + ex - ew / 2
          var py = cy + ey - eh / 2
          var er = Math.min(ew, eh) / 2
          ctx.beginPath()
          ctx.moveTo(px + er, py)
          ctx.arcTo(px + ew, py, px + ew, py + eh, er)
          ctx.arcTo(px + ew, py + eh, px, py + eh, er)
          ctx.arcTo(px, py + eh, px, py, er)
          ctx.arcTo(px, py, px + ew, py, er)
          ctx.closePath()
          ctx.fill()
        }
      }
    }
  }

  MouseArea {
    anchors.fill: parent
    anchors.margins: -2
    cursorShape: Qt.PointingHandCursor
    onClicked: avatar.poke()
  }
}

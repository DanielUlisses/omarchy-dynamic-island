import QtQuick
import qs.Commons

// The island's companion: a soft, glossy face in your theme's foreground with
// two eyes that follow your pointer. It lights up in the colour of whichever
// agent is busy (Claude terracotta, Codex green, Pi cyan, ...), and at larger
// sizes wears a badge saying what it is doing. Its moods:
//   idle      breathes slowly, blinks now and then
//   working   eyes scan back and forth, the glow pulses, a typing badge
//   approval  bounces, eyes wide, an amber "!" badge: something waits on you
//   done      happy eyes and a green check
//   music     bobs and tilts to the beat while media plays
//   poked     squashes, springs back and spins when clicked
Item {
  id: avatar

  property string mood: "idle"
  property color base: "#e8e8f0"
  property color ink: "#16161e"
  property color accent: "#7aa2f7"
  property color glow: accent
  property color alert: "#e0af68"
  property color good: "#9ece6a"
  // -1..1: where the pointer is, relative to the avatar.
  property real lookX: 0
  property real lookY: 0
  // The status badge shows from this size up.
  property bool badge: width >= 34

  signal poked()

  implicitWidth: 22
  implicitHeight: 22

  readonly property color tone: mood === "approval" ? alert : (mood === "done" ? good : (mood === "working" ? glow : accent))
  property color shownTone: tone
  Behavior on shownTone { ColorAnimation { duration: 320; easing.type: Easing.OutCubic } }

  // ---- animated values
  property real breath: 0
  property real blink: 1
  property real bounce: 0
  property real tilt: 0
  property real scan: 0
  property real squash: 0
  property real eyeX: Math.max(-1, Math.min(1, lookX + scan))
  property real eyeY: Math.max(-1, Math.min(1, lookY))
  Behavior on eyeX { SmoothedAnimation { velocity: 2.4 } }
  Behavior on eyeY { SmoothedAnimation { velocity: 2.4 } }

  SequentialAnimation on breath {
    running: avatar.visible
    loops: Animation.Infinite
    NumberAnimation { from: 0; to: 1; duration: avatar.mood === "working" ? 1100 : 2800; easing.type: Easing.InOutSine }
    NumberAnimation { from: 1; to: 0; duration: avatar.mood === "working" ? 1100 : 2800; easing.type: Easing.InOutSine }
  }

  // Working: the eyes read across a line, then glance back.
  SequentialAnimation on scan {
    running: avatar.visible && avatar.mood === "working"
    loops: Animation.Infinite
    onRunningChanged: if (!running) avatar.scan = 0
    NumberAnimation { to: 0.55; duration: 900; easing.type: Easing.InOutQuad }
    PauseAnimation { duration: 260 }
    NumberAnimation { to: -0.45; duration: 520; easing.type: Easing.InOutQuad }
    PauseAnimation { duration: 180 }
  }

  // Blink every few seconds (not while alarmed: eyes stay wide).
  Timer {
    interval: 3200
    repeat: true
    running: avatar.visible && avatar.mood !== "approval" && avatar.mood !== "done"
    onTriggered: { interval = 2400 + Math.random() * 3600; blinkAnim.restart() }
  }
  SequentialAnimation {
    id: blinkAnim
    NumberAnimation { target: avatar; property: "blink"; to: 0.08; duration: 70; easing.type: Easing.InQuad }
    NumberAnimation { target: avatar; property: "blink"; to: 1; duration: 140; easing.type: Easing.OutQuad }
  }

  // Approval: a quick hop that lands with a little squash. Music: a bob.
  SequentialAnimation on bounce {
    running: avatar.visible && (avatar.mood === "approval" || avatar.mood === "music")
    loops: Animation.Infinite
    onRunningChanged: if (!running) avatar.bounce = 0
    NumberAnimation { to: avatar.mood === "approval" ? -0.16 : -0.06; duration: avatar.mood === "approval" ? 200 : 280; easing.type: Easing.OutQuad }
    NumberAnimation { to: 0; duration: avatar.mood === "approval" ? 240 : 300; easing.type: Easing.InQuad }
    PauseAnimation { duration: avatar.mood === "approval" ? 520 : 120 }
  }
  SequentialAnimation on tilt {
    running: avatar.visible && avatar.mood === "music"
    loops: Animation.Infinite
    onRunningChanged: if (!running) avatar.tilt = 0
    NumberAnimation { to: 6; duration: 420; easing.type: Easing.InOutSine }
    NumberAnimation { to: -6; duration: 420; easing.type: Easing.InOutSine }
  }

  // Squash and stretch follow a spring, so every change of shape settles
  // instead of snapping.
  Behavior on squash { SpringAnimation { spring: 4.5; damping: 0.22; epsilon: 0.002 } }
  onBounceChanged: if (mood === "approval") squash = bounce > -0.02 ? 0.12 : -0.08

  function poke() {
    pokeAnim.restart()
    poked()
  }
  SequentialAnimation {
    id: pokeAnim
    ScriptAction { script: avatar.squash = 0.28 }
    PauseAnimation { duration: 90 }
    ScriptAction { script: avatar.squash = 0 }
    RotationAnimation { target: body; property: "rotation"; from: 0; to: 360; duration: 560; easing.type: Easing.OutBack }
  }

  // ---- drawing
  Item {
    id: body
    width: avatar.width
    height: avatar.height
    y: avatar.bounce * avatar.height
    rotation: avatar.tilt
    transformOrigin: Item.Bottom

    // A soft glow in the current tone: a few faint layers, breathing, and
    // stronger while something happens.
    Repeater {
      model: 4
      delegate: Rectangle {
        required property int index
        anchors.centerIn: face
        width: face.width * (1.02 + 0.07 * index + 0.04 * avatar.breath)
        height: face.height * (1.04 + 0.11 * index + 0.05 * avatar.breath)
        radius: Math.min(width, height) * 0.46
        color: avatar.shownTone
        opacity: (avatar.mood === "idle" ? 0.035 : 0.075) * (1 - index * 0.22)
        Behavior on opacity { NumberAnimation { duration: 300 } }
      }
    }

    // The face: a squircle lit from above, tinted by the tone underneath.
    Rectangle {
      id: face
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      width: parent.width * 0.9 * (1 + avatar.squash * 0.5)
      height: parent.height * 0.72 * (1 - avatar.squash) * (1 + 0.02 * avatar.breath)
      radius: Math.min(width, height) * 0.42
      gradient: Gradient {
        GradientStop { position: 0; color: Qt.lighter(avatar.base, 1.12) }
        GradientStop { position: 0.6; color: avatar.base }
        GradientStop { position: 1; color: Qt.tint(avatar.base, Util.alpha(avatar.shownTone, avatar.mood === "idle" ? 0.16 : 0.34)) }
      }

      // Gloss.
      Rectangle {
        x: parent.width * 0.18
        y: parent.height * 0.07
        width: parent.width * 0.42
        height: parent.height * 0.16
        radius: height / 2
        opacity: 0.28
        gradient: Gradient {
          GradientStop { position: 0; color: Util.alpha("#ffffff", 0.9) }
          GradientStop { position: 1; color: Util.alpha("#ffffff", 0) }
        }
      }

      // Eyes: pills that look where the pointer is; arcs when happy.
      Repeater {
        model: 2
        delegate: Item {
          required property int index
          readonly property real side: index === 0 ? -1 : 1
          readonly property real wide: avatar.mood === "approval" ? 1.22 : 1
          width: face.width * 0.1 * wide
          height: face.height * 0.27 * wide
          x: face.width / 2 + side * face.width * 0.15 - width / 2 + avatar.eyeX * face.width * 0.07
          y: face.height * 0.5 - height / 2 + avatar.eyeY * face.height * 0.08

          Rectangle {
            visible: avatar.mood !== "done"
            anchors.centerIn: parent
            width: parent.width
            height: Math.max(width * 0.6, parent.height * avatar.blink)
            radius: width / 2
            color: avatar.ink
          }

          // ^ ^ : two short strokes meeting at the top.
          Item {
            visible: avatar.mood === "done"
            anchors.centerIn: parent
            width: parent.width * 2
            height: parent.width * 1.2
            Repeater {
              model: 2
              delegate: Rectangle {
                required property int index
                width: parent.width * 0.62
                height: Math.max(1, parent.parent.width * 0.55)
                radius: height / 2
                color: avatar.ink
                x: index === 0 ? 0 : parent.width - width
                y: parent.height * 0.35
                rotation: index === 0 ? -38 : 38
                transformOrigin: index === 0 ? Item.Right : Item.Left
              }
            }
          }
        }
      }
    }

    // Badge: what it is doing, on the face's top-left corner.
    Rectangle {
      id: badgeDot
      readonly property bool shown: avatar.badge && avatar.mood !== "idle" && avatar.mood !== "poked"
      x: face.x - width * 0.18
      y: face.y - height * 0.22
      width: avatar.width * 0.27
      height: width
      radius: width / 2
      color: avatar.shownTone
      border.width: Math.max(1.5, width * 0.12)
      border.color: avatar.ink
      scale: shown ? 1 : 0
      opacity: shown ? 1 : 0
      Behavior on scale { SpringAnimation { spring: 5; damping: 0.3; epsilon: 0.005 } }
      Behavior on opacity { NumberAnimation { duration: 160 } }

      // Typing dots while working.
      Row {
        visible: avatar.mood === "working"
        anchors.centerIn: parent
        spacing: badgeDot.width * 0.07
        Repeater {
          model: 3
          delegate: Rectangle {
            required property int index
            width: badgeDot.width * 0.13
            height: width
            radius: width / 2
            color: avatar.ink
            SequentialAnimation on y {
              running: badgeDot.shown && avatar.mood === "working"
              loops: Animation.Infinite
              PauseAnimation { duration: index * 140 }
              NumberAnimation { to: -badgeDot.width * 0.08; duration: 220; easing.type: Easing.OutQuad }
              NumberAnimation { to: 0; duration: 220; easing.type: Easing.InQuad }
              PauseAnimation { duration: (2 - index) * 140 + 200 }
            }
          }
        }
      }

      Text {
        visible: avatar.mood !== "working"
        anchors.centerIn: parent
        text: avatar.mood === "approval" ? "!" : (avatar.mood === "done" ? "✓" : "♪")
        textFormat: Text.PlainText
        font.pixelSize: badgeDot.width * 0.58
        font.bold: true
        color: avatar.ink
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

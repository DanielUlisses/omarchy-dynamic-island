import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons

// A glow around the edges of every monitor that flashes a few times, for
// things you must not miss while looking at another screen (a meeting
// starting). The windows exist only while it flashes, sit on the overlay
// layer (above fullscreen apps) and take no input.
Item {
  id: flash

  property color tone: "red"
  property int count: 3
  property real thickness: 140      // how far the glow reaches in, in px
  property bool active: false

  // Flash `times` times in `color`; a new call restarts it.
  function start(color, times) {
    tone = color
    count = Math.max(1, times || 3)
    active = false
    active = true
  }

  Variants {
    model: flash.active ? Quickshell.screens.filter(function(s) { return s.name !== "" && s.name !== "FALLBACK" }) : []

    PanelWindow {
      required property var modelData
      screen: modelData
      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "dynamic-island-flash"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      mask: Region {}   // click-through

      Item {
        id: glow
        anchors.fill: parent
        opacity: 0

        component Edge: Rectangle {
          property bool vertical: false
          property bool flip: false
          gradient: Gradient {
            orientation: vertical ? Gradient.Vertical : Gradient.Horizontal
            GradientStop { position: 0.0; color: Util.alpha(flash.tone, flip ? 0 : 1) }
            GradientStop { position: flip ? 0.65 : 0.35; color: Util.alpha(flash.tone, 0.4) }
            GradientStop { position: 1.0; color: Util.alpha(flash.tone, flip ? 1 : 0) }
          }
        }

        Edge { anchors { top: parent.top; left: parent.left; right: parent.right } height: flash.thickness; vertical: true }
        Edge { anchors { bottom: parent.bottom; left: parent.left; right: parent.right } height: flash.thickness; vertical: true; flip: true }
        Edge { anchors { top: parent.top; bottom: parent.bottom; left: parent.left } width: flash.thickness }
        Edge { anchors { top: parent.top; bottom: parent.bottom; right: parent.right } width: flash.thickness; flip: true }

        SequentialAnimation {
          running: true
          loops: flash.count
          NumberAnimation { target: glow; property: "opacity"; to: 1; duration: 180; easing.type: Easing.OutCubic }
          PauseAnimation { duration: 260 }
          NumberAnimation { target: glow; property: "opacity"; to: 0; duration: 420; easing.type: Easing.InCubic }
          PauseAnimation { duration: 180 }
          onFinished: flash.active = false
        }
      }
    }
  }
}

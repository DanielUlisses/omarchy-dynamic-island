import QtQuick
import qs.Commons

// Next meeting, compact: calendar glyph, the title scrolling through the
// middle, and the countdown on the trailing edge.
Item {
  id: view

  property var island: null
  readonly property var cal: island.calendar
  readonly property bool started: cal.started
  // A meeting being transcribed owns this view until it stops, whatever the
  // calendar says is next.
  readonly property bool recording: island.transcription.busy

  Text {
    id: glyph
    anchors.left: parent.left
    anchors.leftMargin: island.s(13)
    anchors.verticalCenter: parent.verticalCenter
    text: view.island.transcription.active ? "󰍬" : "󰃭"
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.fontFamily
    font.pixelSize: island.f(15)
    color: view.started || view.island.transcription.active ? island.urgentColor : island.accentColor
  }

  Text {
    id: countdown
    anchors.right: parent.right
    anchors.rightMargin: island.s(14)
    anchors.verticalCenter: parent.verticalCenter
    text: view.recording
      ? Math.max(0, Math.floor((view.cal.now - island.transcription.startedAt) / 60000)) + "m"
      : view.cal.countdown
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.textFamily
    font.pixelSize: island.f(12)
    font.weight: Font.DemiBold
    color: view.started || view.recording ? island.urgentColor : island.accentColor
  }

  // Transcribe this meeting (mic + speakers, Whisper, Ollama summary): shown once it is on or
  // about to start, and while one is being recorded.
  readonly property bool canTranscribe: island.transcription.available
    && (view.recording || !!cal.next && (view.started || cal.next.start - Date.now() < 15 * 60 * 1000))

  Rectangle {
    id: micButton
    visible: view.canTranscribe
    anchors.right: countdown.left
    anchors.rightMargin: island.s(6)
    anchors.verticalCenter: parent.verticalCenter
    width: island.s(22)
    height: width
    radius: width / 2
    color: island.transcription.active ? Util.alpha(island.urgentColor, 0.22) : Util.alpha(island.fg, micMouse.containsMouse ? 0.16 : 0.08)

    Text {
      anchors.centerIn: parent
      text: island.transcription.active ? "󰓛" : "󰍬"
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.fontFamily
      font.pixelSize: island.f(11)
      color: island.transcription.busy ? island.urgentColor : island.fg
      opacity: island.transcription.finishing ? 0.4 : 1
    }

    MouseArea {
      id: micMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: if (!island.transcription.finishing) island.transcription.toggle(view.cal.next ? view.cal.next.title : "")
    }
  }

  Marquee {
    anchors.left: glyph.right
    anchors.leftMargin: island.s(10)
    anchors.right: view.canTranscribe ? micButton.left : countdown.left
    anchors.rightMargin: island.s(10)
    anchors.verticalCenter: parent.verticalCenter
    text: view.recording ? island.transcription.title || "Meeting" : view.cal.next ? view.cal.next.title : ""
    color: island.fg
    fontFamily: island.textFamily
    pixelSize: island.f(12)
    bold: true
    speed: island.s(26)
    gap: island.s(40)
    fadeColor: island.surface
    fadeTop: island.bodyAt(0.25)
    fadeBottom: island.bodyAt(0.75)
    fadeWidth: island.s(10)
  }
}

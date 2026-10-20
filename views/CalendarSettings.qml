import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Calendar settings, in place of the month while it is open: paste a link,
// then per calendar its colour (tap to cycle), label, the browser profile
// its meetings open in, and an ×. Below: keywords to hide and holidays.
// Everything is saved in the island's own files (calendars.json for the
// links, prefs.json for the rest), so the island never reloads mid-edit.
Item {
  id: settings

  property var island: null
  readonly property var cal: island.calendar
  readonly property int pad: island.s(18)

  // Which list the body shows: the calendars, a profile picker for one
  // feed (its link), or the holiday countries.
  property string pickingFor: ""
  property bool pickingHolidays: false
  readonly property var feeds: cal.feeds.filter(function(f) { return f.entry !== cal.holidayLink })

  onVisibleChanged: {
    pickingFor = ""
    pickingHolidays = false
    if (visible) {
      cal.rescanProfiles()
      Qt.callLater(function() { linkField.input.forceActiveFocus() })
    }
  }

  // What a feed's meetings open with right now, for its chip.
  function launchName(feed) {
    var pick = cal.pickFor(feed.url)
    if (pick) return pick.name
    var cmd = Model.launchCommand({ calendar: feed.label, feedUrl: feed.url, provider: "" }, {
      launchers: island.setting("launchers", ""), calendarLaunchers: island.setting("calendarLaunchers", ""),
      browserCommand: island.setting("browserCommand", "") })
    if (!cmd) return "Default browser"
    for (var i = 0; i < cal.launchChoices.length; i++)
      if (cal.launchChoices[i].command === cmd) return cal.launchChoices[i].name
    return "Custom command"
  }

  function nextColor(color) {
    var i = Model.feedPalette.indexOf(String(color).toLowerCase())
    return Model.feedPalette[(i + 1) % Model.feedPalette.length]
  }

  component Caption: Text {
    property var island: null
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    color: island.fg
    elide: Text.ElideRight
  }

  // A rounded text field with a placeholder.
  component Field: Rectangle {
    id: field
    property var island: null
    property alias input: fieldInput
    property string placeholder: ""
    signal committed(string text)
    radius: height / 2
    color: Util.alpha(island.fg, 0.08)
    border.width: fieldInput.activeFocus ? 1 : 0
    border.color: island.accentColor

    TextInput {
      id: fieldInput
      anchors.left: parent.left
      anchors.leftMargin: island.s(12)
      anchors.right: parent.right
      anchors.rightMargin: island.s(12)
      anchors.verticalCenter: parent.verticalCenter
      clip: true
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      color: island.fg
      selectionColor: Util.alpha(island.accentColor, 0.5)
      renderType: Text.NativeRendering
      selectByMouse: true
      Keys.onReturnPressed: field.committed(text)
      Keys.onEnterPressed: field.committed(text)
      Keys.onEscapePressed: island.calendarAdding = false
      onEditingFinished: field.committed(text)

      Text {
        anchors.fill: parent
        visible: fieldInput.text === ""
        text: field.placeholder
        elide: Text.ElideRight
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font: fieldInput.font
        color: island.fgDim
      }
    }

    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.IBeamCursor
      enabled: !fieldInput.activeFocus
      onClicked: fieldInput.forceActiveFocus()
    }
  }

  // A pill button.
  component Chip: Rectangle {
    id: chip
    property var island: null
    property string text: ""
    property color tint: island ? island.fg : "white"
    property real maxWidth: 100000
    property bool strong: false
    signal clicked()
    width: Math.min(chipLabel.implicitWidth + island.s(22), maxWidth)
    radius: height / 2
    color: Util.alpha(tint, chipMouse.pressed ? 0.3 : (chipMouse.containsMouse ? 0.22 : (strong ? 0.16 : 0.08)))

    Text {
      id: chipLabel
      anchors.centerIn: parent
      width: Math.min(implicitWidth, chip.width - island.s(22))
      text: chip.text
      elide: Text.ElideRight
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      font.weight: Font.DemiBold
      color: chip.strong ? chip.tint : island.fg
    }

    MouseArea {
      id: chipMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: chip.clicked()
    }
  }

  // ------------------------------------------------------------- header
  Item {
    id: header
    x: settings.pad
    y: settings.pad
    width: parent.width - settings.pad * 2
    height: island.s(26)

    Text {
      id: title
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: settings.pickingFor ? "Open meetings with…" : (settings.pickingHolidays ? "Holidays" : "Calendar settings")
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(13)
      font.weight: Font.DemiBold
      color: island.fg
    }

    // Result of the last add: green when it worked, red with the reason.
    Caption {
      island: settings.island
      anchors.left: title.right
      anchors.leftMargin: island.s(12)
      anchors.right: close.left
      anchors.rightMargin: island.s(8)
      anchors.verticalCenter: parent.verticalCenter
      visible: !!settings.cal.lastResult && !settings.pickingFor && !settings.pickingHolidays
      text: settings.cal.lastResult ? settings.cal.lastResult.text : ""
      font.pixelSize: island.f(10)
      font.weight: Font.DemiBold
      color: settings.cal.lastResult && settings.cal.lastResult.ok ? island.greenColor : island.urgentColor
    }

    IconButton {
      id: close
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      glyph: settings.pickingFor || settings.pickingHolidays ? "󰁍" : "󰅖"
      glyphSize: island.f(13)
      color: island.fg
      fontFamily: island.fontFamily
      onClicked: {
        if (settings.pickingFor || settings.pickingHolidays) { settings.pickingFor = ""; settings.pickingHolidays = false }
        else island.calendarAdding = false
      }
    }
  }

  // ------------------------------------------------------- main settings
  Column {
    visible: !settings.pickingFor && !settings.pickingHolidays
    x: settings.pad
    y: header.y + header.height + island.s(8)
    width: parent.width - settings.pad * 2
    spacing: island.s(10)

    // Paste a link
    Item {
      width: parent.width
      height: island.s(30)

      Chip {

        island: settings.island
        id: pasteButton
        anchors.right: parent.right
        height: parent.height
        text: "󰆒 Paste"
        tint: island.accentColor
        strong: true
        // Adds the copied link directly, keyboard or not.
        onClicked: island.addCalendarFromClipboard()
      }

      Field {

        island: settings.island
        id: linkField
        anchors.left: parent.left
        anchors.right: pasteButton.left
        anchors.rightMargin: island.s(6)
        height: parent.height
        placeholder: "Add a calendar: paste its .ics link, Enter"
        onCommitted: function(text) {
          var link = text.trim()
          if (!link) return
          island.addCalendar(link)
          linkField.input.text = ""
        }
      }
    }

    // One row per calendar
    ListView {
      id: feedList
      width: parent.width
      height: Math.max(1, Math.min(5, count)) * island.s(36) + Math.max(0, Math.min(5, count) - 1) * spacing
      clip: true
      spacing: island.s(4)
      boundsBehavior: Flickable.StopAtBounds
      model: settings.feeds

      delegate: Rectangle {
        id: row
        required property var modelData
        required property int index
        readonly property string st: settings.cal.statusOf(modelData.entry)
        width: ListView.view.width
        height: island.s(36)
        radius: island.s(12)
        color: Util.alpha(island.fg, 0.05)

        // Colour: tap to cycle through the palette.
        Rectangle {
          id: swatch
          x: island.s(10)
          anchors.verticalCenter: parent.verticalCenter
          width: island.s(16)
          height: width
          radius: width / 2
          color: row.modelData.color
          border.width: swatchMouse.containsMouse ? Math.max(1, island.s(1.5)) : 0
          border.color: island.fg

          MouseArea {
            id: swatchMouse
            anchors.fill: parent
            anchors.margins: -island.s(4)
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: settings.cal.setFeed(row.modelData.entry, row.modelData.label, settings.nextColor(row.modelData.color))
          }
        }

        // Label: edit in place, saved on Enter or when focus leaves.
        Field {
          island: settings.island
          id: labelField
          anchors.left: swatch.right
          anchors.leftMargin: island.s(8)
          anchors.verticalCenter: parent.verticalCenter
          width: island.s(118)
          height: island.s(24)
          placeholder: "Label"
          Component.onCompleted: input.text = row.modelData.label
          onCommitted: function(text) {
            if (text.trim() !== row.modelData.label) settings.cal.setFeed(row.modelData.entry, text.trim(), row.modelData.color)
          }
        }

        // The link, shortened, with what went wrong on the last fetch.
        Caption {
          island: settings.island
          anchors.left: labelField.right
          anchors.leftMargin: island.s(8)
          anchors.right: profileChip.left
          anchors.rightMargin: island.s(8)
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideMiddle
          font.pixelSize: island.f(10)
          text: row.st && row.st !== "ok" ? (row.st.indexOf("HTTP ") === 0 ? row.st.substring(5) + " error" : row.st)
            : row.modelData.url.replace(/^[a-z]+:\/\//, "").replace(/\?.*$/, "")
          color: row.st && row.st !== "ok" ? island.urgentColor : island.fgDim
          font.weight: row.st && row.st !== "ok" ? Font.DemiBold : Font.Normal
        }

        // Where its meetings open: tap to choose.
        Chip {
          island: settings.island
          id: profileChip
          anchors.right: remove.left
          anchors.rightMargin: island.s(4)
          anchors.verticalCenter: parent.verticalCenter
          height: island.s(24)
          maxWidth: island.s(170)
          text: "󰖟 " + settings.launchName(row.modelData)
          onClicked: settings.pickingFor = row.modelData.url
        }

        IconButton {
          id: remove
          anchors.right: parent.right
          anchors.rightMargin: island.s(4)
          anchors.verticalCenter: parent.verticalCenter
          glyph: "󰅖"
          glyphSize: island.f(10)
          color: island.fg
          fontFamily: island.fontFamily
          onClicked: island.removeCalendar(row.modelData.entry)
        }
      }

      Caption {

        island: settings.island
        visible: feedList.count === 0
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        wrapMode: Text.WordWrap
        font.pixelSize: island.f(10)
        color: island.fgDim
        text: "Google: Settings › your calendar › Secret address in iCal format. " +
              "iCloud: share as public calendar. Outlook: Publish a calendar › ICS."
      }
    }

    // Keywords to hide
    Item {
      width: parent.width
      height: island.s(30)

      Caption {

        island: settings.island
        id: excludeLabel
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "󰈉  Hide events containing"
        color: island.fgDim
      }

      Field {

        island: settings.island
        id: excludeField
        anchors.left: excludeLabel.right
        anchors.leftMargin: island.s(10)
        anchors.right: parent.right
        height: parent.height
        placeholder: "lunch, focus time, ooo"
        Component.onCompleted: input.text = settings.cal.excludeText
        onCommitted: function(text) { if (text.trim() !== settings.cal.excludeText) settings.cal.setExclude(text) }
      }
    }

    // Holidays, and how to join from the keyboard.
    Item {
      width: parent.width
      height: island.s(26)

      Chip {

        island: settings.island
        height: parent.height
        text: "󰃭  Holidays: " + (settings.cal.holidayName || "off") + "  ›"
        tint: island.orangeColor
        strong: true
        onClicked: settings.pickingHolidays = true
      }

      Caption {

        island: settings.island
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        font.pixelSize: island.f(10)
        color: island.fgDim
        text: "Join next meeting: omarchy-shell dynamic-island joinNext"
      }
    }
  }

  // -------------------------------------------- profile picker for a feed
  ListView {
    visible: settings.pickingFor !== ""
    x: settings.pad
    y: header.y + header.height + island.s(8)
    width: parent.width - settings.pad * 2
    height: parent.height - y - settings.pad
    clip: true
    spacing: island.s(4)
    boundsBehavior: Flickable.StopAtBounds
    model: [{ id: "", name: "Default browser", detail: "xdg-open, or the launcher set in shell.json" }].concat(settings.cal.launchChoices)

    delegate: Rectangle {
      id: option
      required property var modelData
      readonly property bool chosen: (settings.cal.picks[settings.pickingFor] || "") === modelData.id
      width: ListView.view.width
      height: island.s(32)
      radius: island.s(12)
      color: chosen ? Util.alpha(island.accentColor, 0.2) : Util.alpha(island.fg, optionMouse.containsMouse ? 0.1 : 0.04)

      Caption {

        island: settings.island
        id: optionName
        x: island.s(12)
        anchors.verticalCenter: parent.verticalCenter
        width: Math.min(implicitWidth, parent.width * 0.5)
        text: option.modelData.name
        font.bold: option.chosen
      }

      Caption {

        island: settings.island
        anchors.left: optionName.right
        anchors.leftMargin: island.s(10)
        anchors.right: parent.right
        anchors.rightMargin: island.s(12)
        anchors.verticalCenter: parent.verticalCenter
        font.pixelSize: island.f(10)
        color: island.fgDim
        text: option.modelData.detail
      }

      MouseArea {
        id: optionMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
          settings.cal.setPick(settings.pickingFor, option.modelData.id)
          settings.pickingFor = ""
        }
      }
    }
  }

  // ----------------------------------------------- holiday country picker
  ListView {
    visible: settings.pickingHolidays
    x: settings.pad
    y: header.y + header.height + island.s(8)
    width: parent.width - settings.pad * 2
    height: parent.height - y - settings.pad
    clip: true
    spacing: island.s(2)
    boundsBehavior: Flickable.StopAtBounds
    model: [{ code: "off", name: "No holidays" }].concat(Model.holidayCalendars)

    delegate: Rectangle {
      id: country
      required property var modelData
      readonly property bool chosen: (modelData.code === "off" && settings.cal.holidayCountry === "")
        || modelData.code === settings.cal.holidayCountry
      width: ListView.view.width
      height: island.s(24)
      radius: height / 2
      color: chosen ? Util.alpha(island.accentColor, 0.2) : Util.alpha(island.fg, countryMouse.containsMouse ? 0.1 : 0.03)

      Caption {

        island: settings.island
        anchors.left: parent.left
        anchors.leftMargin: island.s(12)
        anchors.verticalCenter: parent.verticalCenter
        text: country.modelData.name + (country.modelData.code === settings.cal.detectedCountry ? "  (your timezone)" : "")
        font.bold: country.chosen
      }

      MouseArea {
        id: countryMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
          settings.cal.setHolidays(country.modelData.code === settings.cal.detectedCountry ? "auto" : country.modelData.code)
          settings.pickingHolidays = false
        }
      }
    }
  }

}

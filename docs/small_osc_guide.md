Ethernet: OSC Protocol
Please note:  If you are wondering what OSC is or how it would work with an organ, this page probably isn’t for you.  If you are a tinkering type who has configuration software for your controller and would like to remote control using an app such as TouchOSC on an iOS or Android device, then this page would probably be helpful for you.

Please also note that because we are may use broadcast messages, network quality can’t be emphasized enough.  The fewer hops a message has to go through between the Opus-Two controller and the remote device the better.  The higher the quality of the network components the better.

The controller listens on port 9000, and sends on port 8000.  Remote devices need the opposite port numbers set.  Controller responses are sent back to the IP address of the source message.  Up to eight devices will be tracked and responded to.  All responses go to all devices (not just the device that made the request).  The controller will also (by default) “storm” update data.  This data is stormed to any registered OSC devices (any devices that have sent a message in the previous hour or so).  This storm keeps on screen displays (counters, stop status’, etc.) accurate and helps ensure that any missed messages are synced.  Approximately 500 update messages are sent per second, so (again), network quality can’t be emphasized enough.  If sluggishness is experienced, it is almost always a network problem.

OSC Messages follow an exact format.  If there is any deviation at all, they will not work.  The messages are case sensitive.  All characters are equally important in strings, including forward slashes / , back slashes \ , and CAPITALIZATION.  All OSC strings will be listed “in quotes” but the quotes are not part of the string to be sent.

All controls should have local feedback disabled..  The controller card will provide all feedback.  This feature is critical for the user to know that they are still connected to the controller.  An orphaned interface should appear lifeless and not respond to touches.

The controller is in a continuous state of refresh, sending a button state every 1/2 second.  This continuously refreshes any attached devices that have missed a message.  In addition, some parameters (such as record/play data) are sent even more frequently.

Be aware that the “stops” controlled by the iPad are completely separate from the stops controlled by the console.  They do not get merged (at any point).  They are called in the config file for pipe processing using dedicated procedures.

The OSC messages are made up of two parts, a path and a unique number.

Paths:
"/Stops/push" messages cause a latching/maintained control behavior.
"/keyboard/key" messages are momentary messages that are routed to keying buffers.
"/OPTICS/special" messages accomplish specific tasks and have special number codes.

Examples:

“/Stops/push26” is control #26 being processed as a latched button.

Special Button Numbers:

1900-1920 - Piston Recall for tuning interface buttons (completely separate from console C/A).

1999 - Piston Set (latching) for above pistons.  Will be color ID’d red to indicate setting.

2000 - General Cancel will clear all OSC activity, clear all buttons to the off position, send a vibrate message to the device, and immediately send the state of all buttons to clear/paint them.

2001 - Refreshes button state without clearing anything.

2010 - Tuning Sostenuto Toggle

2011 - Tuning Sostenuto Release

2012 - Magic Tuner Enable

2013 - Magic Tuner Diatonic Toggle

2014 - Tuner Back

2015 - Tuner Next

2016 - Touch Button

2020-2027 - Couplers (2020-Unison, 2021 4’/+1Oct, etc.)

2030 - Track + 10

2031 - Track + 1

2032 - Track - 1

2033 - Track - 10

2034 - Toggle Track Protect

2035 - Record

2036 - Play

2037 - Stop

2038 - Mem Level Up

2039 - Mem Level Down

2040 - Folder Up

2041 - Folder Down
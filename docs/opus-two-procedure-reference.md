# **Opus-Two .mod Procedure Reference**

Table of Contents  
[1\. Module structure](#bookmark=id.u7ax6m7kpun5)

[2\. Required order inside Main\_Cycle](#bookmark=id.jvn764kqjnhd)

[3\. Cards, pins, and addressing](#bookmark=id.hy1zj44f0ao5)

[4\. O2S \- system services](#bookmark=id.2z6ynae8y3ng)

[5\. CA \- combination action & system limits](#bookmark=id.n5sfjaadco24)

[6\. GIO \- general I/O](#bookmark=id.fk2p3vj0u9f6)

[7\. P \- pipework](#bookmark=id.9hgo7jnfv4pb)

[8\. Chamber numbering](#bookmark=id.qgsx1tmoq7nx)

[9\. Walker digital voices (WTC)](#bookmark=id.edx46nnlgwx1)

[10\. Expression (shoes and crescendo)](#bookmark=id.m0q1h04jfr6o)

[11\. SPI\_Per \- ribbon peripherals](#bookmark=id.a0g8en8y8mp5)

[12\. Midi\_IO \- general MIDI transmission](#bookmark=id.iozp453jhuqj)

[13\. Out \- logging](#bookmark=id.7x4moebqhhej)

[14\. Constants](#bookmark=id.j68fm5cxzrul)

[15\. Naming and style conventions](#bookmark=id.pxazk9de26ip)

[16\. Quick cheat-sheet](#bookmark=id.rl8ca156diiv)

A complete reference to the procedures, functions, and constants used in Opus-Two pipe-organ control configuration files. Every division's keys, stops, pistons, couplers, expression, and pipework are wired up by calling these from inside Main\_Cycle.

This document replaces the older opus\_two\_procedure\_reference.md and opus\_two\_mod\_reference.md \- everything in both is folded in here, plus every procedure encountered since.

**Notation used below:** \- \_uk \= a keyboard's **uncoupled** form (raw key state, before couplers apply). \- \_k \= a keyboard's **coupled** form (key state after couplers are applied). \- chamber 0 \= the console itself (a self-contained instrument with no remote chamber); chambers 1+ are remote pipe/relay chambers, numbered directly. \- Argument names below are descriptive, not literal identifiers in the file. \- A few entries are marked **(signature not fully confirmed)** \- they've been seen working in a real file but the full behavior of every argument hasn't been pinned down. Treat those as a starting point, not gospel.

---

## **1\. Module structure**

Every config file is one module, with no IMPORT block \- GIO, CA, P, WTC, O2S, SPI\_Per, Serial, and Midi\_IO are all available automatically.

MODULE \<name\>;

CONST  
  (\* stop IDs, then a separate block of rank IDs \- see "Two namespaces" below \*)

TYPE

VAR

PROCEDURE Main\_Cycle();  
BEGIN  
  (\* the entire configuration goes here, in the order in section 2 \*)  
END Main\_Cycle;

BEGIN  
END \<name\>.

* TYPE and VAR section headers are **required even when nothing is declared** \- leave the bare headers in.

* The module body \- a bare BEGIN immediately before END \<name\>. \- is **also required, even when empty**. If the instrument has a Walker digital layer, WTC.Sysex\_Welcome; goes here; otherwise leave it empty. The old startup calls (CA.Reset\_Mem\_Level, CA.Set\_Organist, O2S.Start\_System) are **not needed** \- the framework runs Main\_Cycle on its own.

* No unused scratch variables.

### **Two namespaces: stops and ranks**

Stop IDs and rank IDs are **separate numbering systems**, each starting at 1\. Stops are numbered in drawknob sense order (speaking stops, then couplers, then button-only controls). Rank IDs (Rk\_\*, Dig\_\*) restart from 1 and stay low \- a rank ID indexes an internal rank table, so it must never continue on from wherever the stop numbers left off.

### **Typical startup block**

O2S.set\_display\_port ( Serial.Pmux\_1 );   (\* which serial port the touch display is on \- varies by console \*)  
CA.Set\_enable\_level\_lock ( FALSE );  
CA.Set\_Levels\_Per\_Folder ( 300 );  
CA.Set\_Coil\_Time ( 15 );  
CA.Force\_Cresc\_Number ( 1 );  
CA.Set\_Stop\_Count ( 100 );  
CA.Set\_Max\_Pistons ( 100 );  
CA.Set\_Max\_Cresc\_Stages ( 50 );  
CA.Display\_Last\_General ( TRUE );  
O2S.Prep\_Input\_Buffers ( );  
O2S.Ethernet;

---

## **2\. Required order inside Main\_Cycle**

Combination action in particular needs its finalize calls in the right spot, and a few other calls only make sense after something earlier has run.

1. Startup block (above), plus CA.Enable\_Undo if undo is used.

2. GIO.Opus\_Cards\_IO (GIO.Card\_Invert only if a card is confirmed inverted).

3. Keyboards \- GIO.Map\_Keys / GIO.Map\_Keys\_Dia / SPI\_Per.Get\_Manual.

4. Stop sense \+ coils (Section 6).

5. Pistons \- GIO.Map\_Pistons (generals, then divisionals) and CA.Set\_Last\_General.

6. Reversibles (CA.EC\_Reversable), toggle/lamp buttons (GIO.Map\_Buttons / GIO.Out\_Buttons), undo, memory level, level lock, sequencer.

7. CA.Seq\_Next\_Range and CA.Goto\_Level \- after the piston maps, before Process\_Pistons.

8. Expression reads (Section 12), then anything that depends on them \- the All-Swells IF, GIO.Manual\_Transfer.

9. Immediately above Process\_Pistons: CA.Set\_Cresc\_Step, CA.Set\_Sforz\_Status, then Set / Range / Cancel.

10. CA.Process\_Pistons ( );

11. GIO.Init\_Pipes ( ); \- include even on a capture-only config with no pipes.

12. After Init\_Pipes: P.Stop\_Coupler (unison-offs first), P.New\_Rank, P.Define\_Stop, P.Rank\_Notes\_Out / P.Rank\_Notes\_Dia, P.Stop\_Action, GIO.Ext\_Stp\_Ctrl, P.Expr\_Blades\_Out.

13. If there's a Walker digital layer: WTC.Sysex\_Stop bindings, then one WTC.Send\_Stops.

---

## **3\. Cards, pins, and addressing**

GIO.Opus\_Cards\_IO ( cards\_on\_port1 , cards\_on\_port2 );

The second argument is the card count on a **second** card port \- 0 when the controller has only one port (the usual case). Cards form one continuous chain: card *N* pin 64 is contiguous with card *N+1* pin 1\. A run of pins that spans a card boundary is still **one call**, not two \- the framework wraps automatically. This applies to every card/pin run: keyboards, stop groups, and note-outs alike. Only start a second call for a genuine gap in the wiring.

For an inverting coil card: GIO.Card\_Invert ( card );

---

## **4\. O2S \- system services**

**O2S.set\_display\_port ( port )** port \- serial-mux port the touch display is on, e.g. Serial.Pmux\_1. Varies by console; don't assume it's always port 1\.

**O2S.Prep\_Input\_Buffers ( )** No arguments \- clears the input-scanning buffers before mapping begins.

**O2S.Ethernet** Bare statement (no parentheses) \- brings up network communication.

**O2S.Record\_Play ( )**  Enables the built-in record/playback feature.

**O2S.Set\_Digit\_Data ( digit\_group , value )** Feeds a value to a physical numeric display (memory level, last general pressed, etc). Example: O2S.Set\_Digit\_Data ( 1 , CA.Fetch\_Res\_Mem\_Level() ). A value of 1000 is used as a "blank" sentinel when nothing should display.

**O2S.Update\_Digit\_Brightness ( digit\_group , digit\_index , brightness )** Sets the brightness of one digit position within a group. brightness is typically fed from a user-adjustable variable, e.g. CA.Fetch\_UserVar(2), so the organist can dim the display without a firmware change.

**O2S.Send\_Digit\_Display\_Frame ( port , address , baud , digit\_count )** Transmits the assembled digit-display frame out a serial port. Example: O2S.Send\_Digit\_Display\_Frame ( Serial.Pmux\_2 , 45 , 2000000 , 16 ).

---

## **5\. CA \- combination action & system limits**

**CA.Set\_enable\_level\_lock ( bool )** TRUE locks the memory-level selector, FALSE leaves it free.

**CA.Set\_Levels\_Per\_Folder ( n )** Number of combination memory levels per folder (commonly 300).

**CA.Set\_Coil\_Time ( cycles )** The maximum number of 16 ms cycles a stop coil may stay energized before it's switched off and treated as "didn't move." Industry norm is about a quarter second (15-16 cycles); shorter feels snappier and still works. **Default 15\.**

**CA.Force\_Cresc\_Number ( n )** Declares/forces which crescendo is in use \- 1 for a single crescendo.

**CA.Set\_Stop\_Count ( n )** Capacity reserved for stops. This is a **capacity**, not the highest stop number in the file \- see the sizing rule under Section 6\.

**CA.Set\_Max\_Pistons ( n )** Capacity reserved for pistons.

**CA.Set\_Max\_Cresc\_Stages ( n )** Crescendo resolution (number of stages).

**CA.Display\_Last\_General ( bool )** TRUE shows the last general piston pressed on the digit display.

**CA.Reset\_Mem\_Level** Bare statement \- resets the active memory level. This was historically part of the module's startup body; that startup content is no longer needed, but the module's bare BEGIN...END still is (Section 1).

**CA.Set\_Organist ( n )** Selects the active organist/profile number.

**CA.Fetch\_Res\_Mem\_Level ( )** Returns the current memory (registration) level number, for feeding a digit display.

**CA.get\_last\_general\_pressed ( )** Returns the last general piston pressed, or \-1 if none. Add 1 when feeding a 1-indexed digit display.

**CA.Fetch\_UserVar ( n )** Reads an organist-adjustable value (duty cycle, feedback, display brightness, etc.) stored as user variable n, so the value stays adjustable without a firmware change.

### **Stop sense/coil mapping \- pick the one matching the actual wiring**

All grouping calls below take the same argument order: ( first\_stop , sense\_card , sense\_pin , on\_card , on\_pin , off\_card , off\_pin , qty )

The tab hardware itself (tilting tablet vs. drawknob) does **not** change which call to use \- any stop control built from a sense contact plus separate ON/OFF coils uses the same construct; only the physical wiring pattern (alternating vs. grouped-by-3 vs. all-separate) decides which call applies.

**CA.Map\_Group\_Stops ( ... )** Senses run in a row; ON/OFF coils **alternate** in a row (on-off-on-off, each stepping by one pin). The most common layout.

**CA.Map\_Grouped\_Stops ( ... )** Same arguments, but sense/ON/OFF are wired in repeating **groups of 3** (each stepping by 3 pins).

**CA.Map\_Stop\_Groups ( ... )** Sense contacts, ON coils, and OFF coils are each on their **own separate card** (or row); all three step by 1 pin. Used on combination-action-only ("memory upgrade") jobs with no keyboards or pipe outputs.

**CA.Map\_Coils\_Stops ( first\_stop , on\_card , on\_pin , off\_card , off\_pin , qty )** Maps only the ON/OFF coils for a group \- pair with GIO.Map\_Stops for the sense side when sense and coils are wired completely independently.

**CA.Map\_Single\_Stop ( stop , sense\_card , sense\_pin , on\_card , on\_pin , off\_card , off\_pin )** Wires exactly one stop \- handy for a stop added after the fact.

ON-first vs. OFF-first in the physical wiring doesn't matter; the ON pin and OFF pin are always passed explicitly.

### **CA.Set\_Stop\_Count sizing rule**

It must cover all speaking stops \+ couplers \+ controls, **plus** every mapped **button** (GIO.Map\_Buttons \- a debounced toggle). **Pistons do not count** \- a piston recalls a combination of stops, it isn't stored as a stop itself. Set it generously; a bigger number costs nothing:

Set\_Stop\_Count \= round\_up\_to\_next\_10( all\_stops \+ mapped\_buttons \+ 20 )

### **Pistons**

Map pistons with GIO.Map\_Pistons ( card , pin , qty , first\_piston\_number ) \- note this is a GIO call, not CA, even though pistons are part of the combination action.

* **Generals are the lowest numbers.** CA.Set\_Last\_General ( N ); declares pistons 1..N as generals; everything above N is a divisional or local.

* **Leave room after the generals** \- house rule is 2-3x the general count before divisionals start (18 generals \-\> divisionals start at 37, say).

* Divisionals use the exact same Map\_Pistons call, just with higher numbers. The organist assigns what each piston controls later by capturing combinations \- the config only needs unique numbers.

* **Toe duplicates** reuse the same piston numbers as their thumb equivalents.

* A run that skips a pin needs two calls with continuous numbering across the gap.

* A divisional **cancel** is simply a piston mapped to the next free number; the organist captures it as an empty combination.

### **Set / Range / Cancel / memory / undo \- place directly above Process\_Pistons**

GIO.Set\_Button    ( card , pin );  
GIO.Range\_Button  ( card , pin );          (\* lets the organist rescope a single piston \*)  
GIO.Cancel\_Button ( card , pin );  
CA.Inc\_Mem\_Level  ( GIO.CP( card , pin ) );  
CA.Dec\_Mem\_Level  ( GIO.CP( card , pin ) );  
CA.Undo\_Button    ( GIO.CP( card , pin ) );   (\* needs CA.Enable\_Undo(TRUE,depth) in startup \*)  
CA.Level\_Lock\_Btn ( card , pin );             (\* needs CA.Set\_enable\_level\_lock(TRUE)        \*)  
CA.Goto\_Level     ( GIO.CP( card , pin ) );   (\* after the last Map\_Pistons, before Process   \*)

**CA.Enable\_Undo ( bool , depth )** \- depth is how many presses can be stepped back; map the physical button with CA.Undo\_Button.

**CA.Goto\_Level** / **CA.Goto\_Folder** / **CA.Goto\_Track** \- hold the button and type the target number on the general pistons (General 10 enters a 0).

**CA.Seq\_Next\_Range ( arm , start , finish )** \- an "ALL NEXT" control: while arm (a GIO.Button(x), x \> 1 since button 1 is the Tutti) is held, pistons start..finish all act as Next. Place between the piston maps and Process\_Pistons.

### **Reversibles**

CA.EC\_Reversable ( GIO.DB\_CP( card , pin ) , stop1 , stop2 , stop3 , stop4 );

* stop1 is the primary stop/coupler the button toggles (the unison 8' for a coupler); stop2..stop4 gang related couplers (16'/4') to the same button \- 0 for unused slots.

* Always read the reversible contact with GIO.DB\_CP (debounced), never GIO.CP.

* Works for plain stop reversibles too (32' stops, Zimbelstern) \- put the stop in stop1.

* A coupler commonly has **both** a thumb and a toe reversible \- that's two separate EC\_Reversable calls, one per contact, both referencing the same stop numbers.

* Formerly named East\_Coast\_Reversable; use the short name.

### **Sequencer**

CA.Seq\_Enable ( TRUE );            (\* or a boolean/button condition \*)  
CA.Seq\_Fires\_From\_GC ( TRUE );     (\* from a cancelled state, Next fires General 1 \*)  
CA.Seq\_Next ( GIO.DB\_CP ( card , pin ) );  
CA.Seq\_Prev ( GIO.DB\_CP ( card , pin ) );

Use GIO.DB\_CP for sequencer buttons. Prev is optional \- only map what's physically wired.

### **Sforzando and crescendo**

CA.Set\_Sforz\_Status ( sforz\_number , GIO.Button(1) );  
CA.Set\_Cresc\_Step   ( cresc\_number , GIO.Expr(byte) );

Both go directly above Process\_Pistons. With no crescendo shoe at all, hold the engine silent: CA.Force\_Cresc\_Number(1); in startup, then CA.Set\_Cresc\_Step ( 1 , 0 ); (a literal 0 instead of an expression byte).

---

## **6\. GIO \- general I/O**

**GIO.Opus\_Cards\_IO**, **GIO.Card\_Invert** \- see Section 3\.

**GIO.Map\_Keys ( card , pin , keyboard\_uk , first\_note , count )** Legacy parallel key contacts. Always map with the \_uk form. Example \- pedal CCC-G on card 1 pins 25-56: GIO.Map\_Keys ( 1 , 25 , pd\_uk , 1 , 32 );

**GIO.Map\_Keys\_Dia ( card1 , pin1 , card2 , pin2 , keyboard\_uk , first\_note , count )** Diatonic split keying \- the chest's C-side and C\#-side contacts are on two separate card/pin groups.

**SPI\_Per.Get\_Manual ( ribbon\_port , message\_id , keyboard\_uk , first\_note , count )** Opus-Two magnetic/Hall-effect keying over SPI. The display occupies ribbon 1 (Serial.Pmux\_1); keyboards take the ribbons after that. Since each keyboard is usually on its own ribbon, the message ID can be 1 for all of them.

A division with electric stop action but no key-sense card and no per-note coils is mechanically/EP keyed \- map only its stops, not its keys.

**GIO.Map\_Midi\_Keys ( ... )** *(signature not fully confirmed)* \- maps an incoming MIDI note stream to a keyboard buffer; seen as GIO.Map\_Midi\_Keys ( midi\_port , channel , note\_offset , keyboard\_uk , first\_note , count ).

**GIO.Map\_Midi\_Stops ( ... )** *(signature not fully confirmed)* \- the stop equivalent, mapping incoming MIDI to the stop-state buffer.

**GIO.Map\_Pistons** \- see Section 5 (Pistons).

**GIO.Map\_Stops ( card , pin , qty , first\_stop )** Maps stop *sense* contacts only \- pair with CA.Map\_Coils\_Stops for the coils when sense and coils are wired completely independently of each other.

**GIO.Map\_Buttons ( card , pin , button\_number )** Maps a toggle/debounced button (Tutti, Zimbelstern, Auto Pedal, etc.) to a numbered button slot. **Counts toward Set\_Stop\_Count.**

**GIO.Out\_Buttons ( card , pin , button\_number )** The lamp output for a button mapped above.

**CA.Map\_Buttons\_To\_Stops ( first\_button , qty , stop )** Mirrors a button's state into a stop constant, so pistons \- which capture *stops*, not buttons \- can save and recall it. Auto Pedal and a manual-to- manual melody coupler both need this alongside their GIO driver call below, or a captured combination silently loses that control.

**GIO.Auto\_Bass ( enable , ab\_num , k\_lim , keyboard\_uk )** **GIO.Auto\_Bass\_nr ( enable , ab\_num , k\_lim , keyboard\_uk )** Sounds a pedal note derived from the lowest note held on a manual. \- enable \- what turns it on, e.g. GIO.Button(n) or GIO.Stop(...). \- ab\_num \- a sequential ID unique per auto-bass in use, starting at 1 (keeps each one's internal tracking state from colliding with another). \- k\_lim \- how far up the keyboard it acts before giving up; default 32\. \- keyboard\_uk \- the manual it watches, usually gr\_uk. \- Auto\_Bass drops the sounded note to the **bottom pedal octave**; Auto\_Bass\_nr sounds it **at the octave actually played**. Default to Auto\_Bass unless told otherwise.

**GIO.Fluid\_Melody\_Coupler\_1 ( enable , unused , unused , src\_uk , dst\_uk )** Couples the top note of src\_uk onto dst\_uk \- an automatic melody coupler. enable is the driving button/stop condition.

**GIO.Manual\_Transfer ( condition , keyboard1\_uk , keyboard2\_uk )** Swaps two manuals' key assignment while condition is true. Place after keys, stops, and analog reads are all mapped. This is the default way to express a transferable manual \- use the keyboard-IF pattern (mapping each keyboard inside IF ... THEN ... ELSE ... END;) only for the special case where two *divisions* genuinely share one physical keyboard, which Manual\_Transfer can't express.

**GIO.Ext\_Stp\_Ctrl ( condition , chamber , card , pin )** Drives a chamber output from a live condition \- trems, cymbalstern, shades, lamps. condition is GIO.Button(n) or GIO.Stop(stop), or a boolean expression (GIO.Expr(box) \> 60, etc). chamber is 0 for the console.

**GIO.Init\_Pipes ( )** No arguments \- the divider between console setup (above it) and pipework (below it). Include even on a capture-only config with no pipes at all.

**GIO.Set\_Expr ( byte , value )** **GIO.Set\_Expr\_Merge ( box , adc\_value , midi\_value )** Sets an expression byte's value from an analog read, a MIDI expression pedal, or both merged. See Section 12\.

**GIO.Set\_Rem\_Midi\_Expr ( midi\_chamber , walker\_channel , GIO.Expr(box) )** Forwards a console expression box's value to a remote Walker digital channel, so a digital voice tracks a physical shoe. See Section 9\.

**GIO.Expression\_Roller ( card , pin , num\_stages )** Reads a stepped/roller (contact-type) expression shoe instead of an analog potentiometer.

**GIO.Midi\_Expr\_In ( port , midi\_channel )** Reads an incoming MIDI expression-pedal value, typically merged with an analog read via Set\_Expr\_Merge.

**GIO.Midi\_Expr\_Out ( midi\_channel , expr\_byte , controller )** Transmits an expression byte's value out over MIDI.

**GIO.Midi\_Keys\_Out ( ... )** *(signature not confirmed)* \- transmits a keyboard's notes over MIDI.

**GIO.Midi\_Stops\_Out ( ... )** *(signature not confirmed)* \- transmits stop states over MIDI, e.g. to an outboard tone expander.

### **Value / reference helpers (used as arguments to the calls above)**

* **GIO.CP ( card , pin )** \- a plain (non-debounced) contact-pin reference.

* **GIO.DB\_CP ( card , pin )** \- a debounced contact-pin reference; use for reversibles and sequencer buttons.

* **GIO.Expr ( byte )** \- current value of an expression byte.

* **GIO.Button ( n )** \- current state of toggle button n.

* **GIO.Stop ( stop )** \- current on/off state of a stop.

* **CA.Calc\_ADC ( analog\_input , steps )** \- reads an analog input and scales it to steps (commonly 132, which is 127 MIDI-compatible plus a 5 offset \- subtract 5 after the call to land on 0-127).

---

## **7\. P \- pipework**

**P.New\_Rank ( rank , "Name" , pitch , note\_count , type )** \- rank \- rank ID (its own namespace \- see Section 1). \- pitch \- the rank's lowest sounding pitch, e.g. p\_8, p\_16. \- note\_count \- number of pipes in the rank. \- type \- P.Unit (a unit/extension rank, played at multiple pitches) or P.Primary (an independent rank that only ever sounds at its own pitch).

**P.Define\_Stop ( stop , cond , mode , rank , pitch , keyboard\_k , first\_note , last\_note )** \- mode (3rd arg) selects what cond (2nd arg) means whenever cond \> 0: \- 10 \- cond is a stop that must be **OFF** for this stop to play. With cond \= \-1 (the normal case), there's no condition and the stop always plays. \- 11 \- cond is a stop that must also be **ON**. \- 12 \- cond is an **OSC (iPad) button** number for this stop. \- 99 \- the stop is **permanently on**. \- rank \- the rank it draws from. \- pitch \- the pitch it sounds at. A unit rank gets one Define\_Stop per derived pitch (e.g. both 16' and 8' off the same rank). \- keyboard\_k \- \_k for an ordinary rank, \_uk for a selective rank that must ignore couplers (chamades, chimes, floating ranks). \- first\_note , last\_note \- the section of the rank this stop plays. \-1,-1 is full compass \- prefer this whenever the stop plays the whole rank. Any value 1-85 gives a partial section (a resultant stop, for example, might draw p\_16 and p\_10\_2f3 on notes 1,12, plus p\_32 on notes 13,44).

Tip: declare OSC/iPad button numbers as named constants up top, e.g. OSC\_Swell\_Flute\_8 \= 1;, then pass those names rather than bare numbers.

**P.Rank\_Notes\_Out ( rank , note\_count , direction , chamber , card , pin )** \- direction \- P.Forward (lowest pipe \= lowest pin) or P.Reverse. \- The card chain is continuous, so a rank spanning more than one card is still **one call** \- never split at a card boundary. Only use a second call for a genuine, non-adjacent gap; calls append in note order.

**P.Rank\_Notes\_Dia ( rank , qty , dir , chamber , card , pin , dir2 , chamber2 , card2 , pin2 )** Output-side mirror of Map\_Keys\_Dia \- a rank split across two chests (C-side and C\#-side), each half with its own direction, chamber, card, and pin.

**P.Stop\_Action ( stop , osc\_button , chamber , card , pin )** Drives a stop's physical output \- slider solenoid, coupler relay, tremulant motor. osc\_button is an OSC (iPad) button number, or \-1 if there isn't one. (Internally, this calls Ext\_Stp\_Ctrl.)

**P.Stop\_Coupler ( coupler\_stop , dest\_k , src\_uk , pitch )** Read the coupler as "X to Y": playing keyboard **Y** makes division **X** sound. \- dest\_k \- the division that **sounds** (the "X"), \_k form. \- src\_uk \- the keyboard you **play** (the "Y"), \_uk form. \- pitch \- p\_8 unison, p\_16 sub, p\_4 super, p\_0 unison-off. \- **Unison-off couplers** are the exception: use \_k for **both** arguments (e.g. Sw\_Unison\_Off , sw\_k , sw\_k , p\_0), and **define every unison-off before any other coupler**.

P.Stop\_Coupler ( Sw\_U\_O  , sw\_k , sw\_k  , p\_0  );  (\* Swell unison off \- define first \*)  
P.Stop\_Coupler ( Sw\_Gr\_8 , sw\_k , gr\_uk , p\_8 );   (\* Swell to Great: play Great \-\> Swell sounds \*)  
P.Stop\_Coupler ( Gr\_Pd\_8 , gr\_k , pd\_uk , p\_8 );   (\* Great to Pedal: play Pedal \-\> Great sounds \*)

**P.Expr\_Blades\_Out ( expr\_byte , num\_blades , chamber , card , pin )** Drives the physical swell-shade blade outputs from an expression byte. num\_blades consecutive pins are used, one per stage.

---

## **8\. Chamber numbering**

The chamber argument that appears in Rank\_Notes\_Out, Stop\_Action, and Ext\_Stp\_Ctrl: \- **Chamber 0 \= console.** A self-contained instrument with no remote card planes uses chamber 0 everywhere. \- Chambers 1 and up are remote pipe/relay chambers, numbered directly.

---

## **9\. Walker digital voices (WTC)**

Built in \- no IMPORT needed.

* **Channel \<-\> card:** each MIDI channel spans two cards of 64 pins each; the odd card is 2 \* channel \- 1, and **pin 25 is note 1**.

* **The digital "chamber" is channel-encoded, not a physical card port.** The card number used in a digital primary's Rank\_Notes\_Out is 2\*ch-1 \- a Walker-channel address, not a physical Opus\_Cards\_IO card \- so it doesn't count against the card total, and it stays the same across every console attached to the same Walker unit (same digital chamber, same channels, same transmit octet).

**Primary rank (independent digital voice), once per channel:**

P.New\_Rank ( Dig\_\<Div\>\_Primary , "Digital \<Div\>" , p\_16 , 85 , P.Primary );  
P.Rank\_Notes\_Out ( Dig\_\<Div\>\_Primary , 85 , P.Forward , \<midi\_chamber\> , 2\*ch-1 , 25 );

**Every digital stop needs the full set below, or it stays silent** even though it looks fully defined: 1\. The primary's New\_Rank (once per channel). 2\. The primary's Rank\_Notes\_Out (once per primary). 3\. P.Define\_Stop ( stop , \-1 , 10 , \<primary\> , p\_8 , keyboard\_k , \-1 , \-1 ) \- into a primary rank, always at **p\_8** (the Walker voice itself carries the real pitch). Into a digital **unit** rank (one flagged as such on the Walker spec sheet), use the stop's **actual playing footage** instead. 4\. WTC.Sysex\_Stop ( control\_number , stop ) \- selects the voice. One control number can bind more than one stop (e.g. a Tuba voice drawn from both Solo and Pedal). 5\. One WTC.Send\_Stops ( nano\_m\_octet ); after every binding. This is the correct transmit call \- an older, incorrect form (WTC.Send\_Sysex) may still appear in older files; if you find it, it should be replaced with Send\_Stops. 6\. WTC.Sysex\_Welcome; \- goes once, in the module's bare body after Main\_Cycle, not inside Main\_Cycle itself. 7\. If the digital division is enclosed, expression forwarding via GIO.Set\_Rem\_Midi\_Expr (Section 6/Section 12\) \- without it, the voice plays at full volume regardless of the shoe.

**Borrowed digital voice:** a stop can pull *another* division's voice by using that division's primary and that division's keying, bound to the source control number \- two stops can legitimately share one control number this way.

---

## **10\. Expression (shoes and crescendo)**

**Analog shoe (potentiometer) \- the standard input:**

GIO.Set\_Expr ( expr\_byte , CA.Calc\_ADC ( analog\_input , 132 ) \- 5 );

or, when the console also accepts a MIDI expression pedal on the same box:

GIO.Set\_Expr\_Merge ( box , CA.Calc\_ADC( analog\_input , 132 ) \- 5 , GIO.Midi\_Expr\_In ( 1 , midi\_channel ) );

**Contact shoe (stepped/roller) \- older style:**

GIO.Set\_Expr ( expr\_byte , GIO.Expression\_Roller ( card , pin , num\_stages ) );

**Crescendo shoe**, tied to a crescendo number, placed directly above Process\_Pistons:

CA.Set\_Cresc\_Step ( cresc\_number , GIO.Expr(byte) );

No crescendo shoe? Force the engine onto crescendo 1 and hold it silent with a literal 0 instead of an expression byte:

CA.Force\_Cresc\_Number ( 1 );      (\* startup block \*)  
CA.Set\_Cresc\_Step ( 1 , 0 );      (\* above Process\_Pistons \*)

**"All Swells to Swell"** \- after the shoe reads, copy the master box's value onto the other boxes while the control stop is on:

IF GIO.Stop ( All\_Swells ) THEN  
  GIO.Set\_Expr ( 1 , GIO.Expr(3) );  
  GIO.Set\_Expr ( 2 , GIO.Expr(3) );  
END;

**Physical shade blades:** P.Expr\_Blades\_Out ( expr\_byte , num\_blades , chamber , card , pin );

**Digital voice tracking a shoe:** GIO.Set\_Rem\_Midi\_Expr ( midi\_chamber , walker\_channel , GIO.Expr(box) ); \- forward only for enclosed digital divisions; unenclosed channels (pedal, non-coupling tubas) get none.

**MIDI expression out:** GIO.Midi\_Expr\_Out ( midi\_channel , expr\_byte , controller );

When an expression byte's number changes, update every place that references it \- blades, MIDI, crescendo, and any Walker forwarding \- consistently.

---

## **11\. SPI\_Per \- ribbon peripherals**

**SPI\_Per.Get\_Manual ( ribbon\_port , message\_id , keyboard\_uk , first\_note , count )** \- see Section 6\.

**SPI\_Per.Map\_SC\_Coil\_Group ( ribbon\_port , first\_stop , qty , group , 0 , 200 , 0 , duty , fb , end\_duty )** Maps a serial coil chain (as opposed to parallel card/pin coils). \- 0 , 200 , 0 \- fixed legacy values; always pass exactly these. \- duty, fb, end\_duty \- coil duty cycle / feedback / end-duty, normally fed from CA.Fetch\_UserVar(1..3) so an organist can adjust them without a firmware change.

---

## **12\. Midi\_IO \- general MIDI transmission**

**Midi\_IO.Midi\_Out ( source , port , channel , low\_note\_or\_0 , high\_note\_or\_127 )** Transmits a keyboard's notes or the stop-state buffer over MIDI. Seen driving GIO.O2\_Blk.man\[\<kbd\>\_uk\] (a keyboard's raw note buffer) and GIO.O2\_Blk.Stops\_in (the stop-state buffer).

**Midi\_IO.Midi\_Expr\_Out ( port , channel , expr\_source )** Transmits an expression byte over MIDI; seen driving GIO.O2\_Blk.expr\_in\[n\].

These two calls are less commonly used than GIO.Midi\_Expr\_Out above and have shown up commented-out in at least one working file \- confirm they're wanted before wiring them live.

---

## **13\. Out \- logging**

**Out.String ( "text" )** \- writes a line of text to the system log. **Out.Ln ( )** \- writes a newline to the log.

---

## **14\. Constants**

**Pitch:** p\_0 (unison-off), p\_32, p\_16, p\_8, p\_4, p\_2, p\_2\_2f3, p\_1\_3f5, p\_1\_1f3, p\_1, mixtures as \_III, etc.

**Keyboards:** each division has an uncoupled form \*\_uk and a coupled form \*\_k. Standard division abbreviations: gr Great, sw Swell, ch Choir, so Solo, pd Pedal, po Positiv. Use \_uk for all key/stop *mapping* and for the *source* side of a coupler; use \_k for the *destination* side of a coupler and for Define\_Stop on an ordinary rank.

**Rank type:** P.Unit, P.Primary.

**Direction:** P.Forward, P.Reverse.

**Serial ports:** Serial.Pmux\_1 .. Serial.Pmux\_n.

---

## **15\. Naming and style conventions**

* **Couplers:** Source\_Dest\_Pitch, e.g. Sw\_Gr\_8, Gr\_Pd\_8, So\_Ch\_16.

* **Stops:** Division\_Voice\_Pitch in Title\_Case, e.g. Pd\_Soubasse\_32, Gr\_Trompette\_8, Sw\_Spitzflote\_2. Pitch tokens: \_16 \_8 \_4 \_2 \_1, fractional as \_1\_1f3 (1-1/3'), mixtures as \_III.

* Division prefixes: Gr Sw Ch So Pd Po.

* Normalize obvious misspellings in identifiers (Principle \-\> Principal).

* Column-align argument lists; use section-banner comments like (\* \=== ... \=== \*).

* **Stop IDs and rank IDs are separate namespaces** \- see Section 1\.

### **Common instrument patterns**

* **Slider-chest manual division:** the division shares one note-bus rank (Rk\_\<Div\>\_Main, P.Primary), and each stop adds a slider via P.Stop\_Action. Every slider stop's Define\_Stop draws the bus at p\_8 \- the pitch is physical in the pipes, so there's no software transposition for primary ranks (unit ranks \- pedal/reed extensions \- do transpose per pitch).

* **Resultant (acoustic bass):** model as 2-3 Define\_Stops on one tab drawing a wood Open or Bourdon \- e.g. p\_16 and p\_10\_2f3 on notes 1,12, plus p\_32 on notes 13,44. Higher harmonics can be left undone.

* **Diatonic keying/output:** chests split into C and C\# sides use GIO.Map\_Keys\_Dia on input and P.Rank\_Notes\_Dia on output.

* **Combination-action-only config** ("memory upgrade"): no keyboards, no pipe outputs \- just stop senses \+ ON/OFF coils (CA.Map\_Stop\_Groups), pistons, the piston/sequencer controls, CA.Process\_Pistons, and GIO.Init\_Pipes (include it even with no pipes). Tutti is wired as a sforzando; a silent crescendo is held with CA.Set\_Cresc\_Step(1,0).

### **Don't infer instrument facts from names**

A string inside a constant name is just a label someone typed \- a builder name pulled in from an example file, a device nickname, an old technician's shorthand. Never assume what an instrument has, who built it, or what a control targets based on spelling in a name; confirm from the actual wiring.

---

## **16\. Quick cheat-sheet**

GIO.Opus\_Cards\_IO ( cards\_on\_port1 , cards\_on\_port2 )  
GIO.Card\_Invert ( card )  
GIO.Map\_Keys ( card , pin , kbd\_uk , first\_note , count )  
GIO.Map\_Keys\_Dia ( card1 , pin1 , card2 , pin2 , kbd\_uk , first\_note , count )  
SPI\_Per.Get\_Manual ( ribbon , msg\_id , kbd\_uk , first\_note , count )

CA.Map\_Group\_Stops   ( first\_stop , s\_card , s\_pin , on\_card , on\_pin , off\_card , off\_pin , qty )  
CA.Map\_Grouped\_Stops ( first\_stop , s\_card , s\_pin , on\_card , on\_pin , off\_card , off\_pin , qty )  
CA.Map\_Stop\_Groups   ( first\_stop , s\_card , s\_pin , on\_card , on\_pin , off\_card , off\_pin , qty )  
GIO.Map\_Stops ( card , pin , qty , first\_stop )  
CA.Map\_Coils\_Stops ( first\_stop , on\_card , on\_pin , off\_card , off\_pin , qty )  
CA.Map\_Single\_Stop ( stop , s\_card , s\_pin , on\_card , on\_pin , off\_card , off\_pin )  
SPI\_Per.Map\_SC\_Coil\_Group ( ribbon , stop\# , qty , group , 0 , 200 , 0 , duty , fb , end\_duty )

GIO.Map\_Pistons ( card , pin , qty , first\_piston\_number )  
CA.Set\_Last\_General ( N )  
GIO.Set\_Button ( card , pin ) ;  GIO.Cancel\_Button ( card , pin ) ;  GIO.Range\_Button ( card , pin )  
CA.Inc\_Mem\_Level ( GIO.CP(card,pin) ) ;  CA.Dec\_Mem\_Level ( GIO.CP(card,pin) )  
CA.Enable\_Undo ( TRUE , depth ) ;  CA.Undo\_Button ( GIO.CP(card,pin) )  
CA.Set\_enable\_level\_lock ( TRUE ) ;  CA.Level\_Lock\_Btn ( card , pin )  
CA.Goto\_Level ( GIO.CP(card,pin) )       (\* after last Map\_Pistons, before Process \*)

CA.EC\_Reversable ( GIO.DB\_CP(card,pin) , stop1 , stop2 , stop3 , stop4 )

GIO.Map\_Buttons ( card , pin , button\# ) ;  GIO.Out\_Buttons ( card , pin , button\# )  
CA.Map\_Buttons\_To\_Stops ( first\_button , qty , stop )  
GIO.Auto\_Bass    ( enable , ab\_num , k\_lim , kbd\_uk )  
GIO.Auto\_Bass\_nr ( enable , ab\_num , k\_lim , kbd\_uk )  
GIO.Fluid\_Melody\_Coupler\_1 ( enable , 0 , 0 , src\_uk , dst\_uk )  
GIO.Manual\_Transfer ( condition , kbd1\_uk , kbd2\_uk )

GIO.Set\_Expr ( byte , CA.Calc\_ADC ( analog\# , 132 ) \- 5 )  
GIO.Set\_Expr\_Merge ( box , CA.Calc\_ADC( analog\# , 132 )-5 , GIO.Midi\_Expr\_In ( 1 , midi\_ch ) )  
GIO.Set\_Expr ( byte , GIO.Expression\_Roller ( card , pin , stages ) )  
CA.Set\_Cresc\_Step ( cresc\# , GIO.Expr(byte) )  
CA.Set\_Sforz\_Status ( sforz\# , GIO.Button(n) )  
P.Expr\_Blades\_Out ( byte , num\_blades , chamber , card , pin )  
GIO.Midi\_Expr\_Out ( midi\_channel , byte , controller )  
GIO.Set\_Rem\_Midi\_Expr ( midi\_chamber , walker\_channel , GIO.Expr(box) )

CA.Seq\_Enable ( TRUE ) ;  CA.Seq\_Fires\_From\_GC ( TRUE )  
CA.Seq\_Next ( GIO.DB\_CP(card,pin) ) ;  CA.Seq\_Prev ( GIO.DB\_CP(card,pin) )  
CA.Seq\_Next\_Range ( GIO.Button(x) , start , finish )   (\* x\>1; between Map\_Pistons and Process \*)

CA.Process\_Pistons ()        (\* right before Init\_Pipes \*)  
GIO.Init\_Pipes ()

P.Stop\_Coupler ( stop , dest\_k , src\_uk , pitch )  
P.New\_Rank ( rank , "Name" , pitch , notes , P.Unit )  
P.Define\_Stop ( stop , \-1 , 10 , rank , pitch , kbd\_k , first\_note , last\_note )   (\* \-1,-1 \= full compass \*)  
P.Rank\_Notes\_Out ( rank , notes , P.Forward , chamber , card , pin )  
P.Rank\_Notes\_Dia ( rank , qty , dir , chamber , card , pin , dir2 , chamber2 , card2 , pin2 )  
P.Stop\_Action ( stop , \-1 , chamber , card , pin )  
GIO.Ext\_Stp\_Ctrl ( condition , chamber , card , pin )

(\* Walker digital layer \*)  
P.New\_Rank ( Dig\_\<Div\>\_Primary , "Digital \<Div\>" , p\_16 , 85 , P.Primary )  
P.Rank\_Notes\_Out ( Dig\_\<Div\>\_Primary , 85 , P.Forward , midi\_chamber , 2\*ch-1 , 25 )  
WTC.Sysex\_Stop ( control\# , stop )  
WTC.Send\_Stops ( nano\_m\_octet )       (\* once, after all bindings \*)  
WTC.Sysex\_Welcome;                    (\* module body, not Main\_Cycle \*)

O2S.Set\_Digit\_Data ( digit\_group , value )  
O2S.Update\_Digit\_Brightness ( digit\_group , digit\_index , brightness )  
O2S.Send\_Digit\_Display\_Frame ( port , address , baud , digit\_count )  
CA.Fetch\_Res\_Mem\_Level ( )  
CA.get\_last\_general\_pressed ( )
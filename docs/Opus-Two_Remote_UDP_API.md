# Opus-Two Remote UDP Command API

Reference for the text command interface handled by `Decode_Remote_UDP_Cmds`. A
client sends an ASCII command in a UDP datagram; the console acts on it and
replies to the sender's IP address.

---

## Establishing Known Entity

Any device that wishes to send an API command to an Opus-Two controller must already be
in the controller's SSDP list for the command to be accepted.  For existing Opus-Two
controllers, that enrollment is automatic via SSDP announcements.  For third party
applications, this must be done by sending an SSDP announcement every few seconds (Opus
Two controllers send the announcements every 5 seconds).

SSDP Build examples in various languages:

# Oberon
PROCEDURE SSDP_Msg* ( unique : ARRAY OF CHAR; bye : BOOLEAN );
    BEGIN
       device1 := "Opus-Two CVE";
       Init_Tx_Msg ( 239, 255, 255, 250  , 1900, UDP_Msg );
       Set_DHAR ( 7, 255,255,255,255,255,255 ); (* broadcast *)
       Append_String_CRLF ("NOTIFY * HTTP/1.1" , UDP_Msg );              (* build msg *)
       Append_String_CRLF ("HOST: 239.255.255.250:1900" , UDP_Msg );    
       Append_String_CRLF ("NTS:ssdp:alive" , UDP_Msg );       
       W.Append_String      ("NT:urn:" , UDP_Msg ); W.Append_String_CRLF ( device1, UDP_Msg ); 
       W.Append_String      ("USN:uuid:" , UDP_Msg ); 
       FOR j := 0 TO 3 DO Append_Byte_Hex_ns ( uuid[j] , UDP_Msg ) END;    (* formatted uuid *)
       Append_Char ("-" , UDP_Msg );
       FOR j := 4 TO 5 DO Append_Byte_Hex_ns ( uuid[j] , UDP_Msg ) END;
       Append_Char ("-" , UDP_Msg );
       FOR j := 6 TO 7 DO Append_Byte_Hex_ns ( uuid[j] , UDP_Msg ) END;
       Append_Char ("-" , UDP_Msg );
       FOR j := 8 TO 9 DO Append_Byte_Hex_ns ( uuid[j] , UDP_Msg ) END;
       Append_Char ("-" , UDP_Msg );
       FOR j := 10 TO 15 DO Append_Byte_Hex_ns ( uuid[j] , UDP_Msg ) END;  (* the mac address *)       
       Append_String      ("::urn:" , UDP_Msg ); 
       Append_String_CRLF ( device1, UDP_Msg );
       Append_String_CRLF ("CACHE-CONTROL: max-age=3600" , UDP_Msg );       
       Append_String_CRLF ("LOCATION: * ", UDP_Msg );
       Send_UPD ( UDP_Msg );                                         (* send the msg on socket 7 *)
       next_notify := current_msec_ + 5000;
END SSDP_Msg;

# LUA
function ssdp_xmit()
  local udp = UdpSocket.New()
  local ssdp_payload = "NOTIFY * HTTP/1.1" .. "\r\n" ..
  "Host:239.255.255.250:1900" .. "\r\n" ..
  "NT:urn:Opus-Two API" .. "\r\n" ..
  "NTS:ssdp:alive" .. "\r\n" ..
  "USN:uuid:436F6E73-6F6C-6536-0000-3C2EF5AC69F1::urn:Opus-Two API" .. "\r\n" ..
  "Cache-Control:max-age=3600" .. "\r\n\r\n" 
  udp:Open()
  udp:Send("239.255.255.250", 1900, ssdp_payload)
end

# Swift
  private func startBeacon() {
        sendBeacon()
        beaconTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.sendBeacon() }
        }
    }

    private func stopBeacon() {
        beaconTimer?.invalidate()
        beaconTimer = nil
    }

    private func sendBeacon() {
        let uuid = beaconUUID
        let payload = "NOTIFY * HTTP/1.1\r\n" +
                      "Host:239.255.255.250:1900\r\n" +
                      "NT:urn:Opus-Two API\r\n" +
                      "NTS:ssdp:alive\r\n" +
                      "USN:uuid:\(uuid)::urn:Opus-Two API\r\n" +
                      "Cache-Control:max-age=3600\r\n\r\n"

        let fd = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP) // Bypass Everybody
        guard fd >= 0 else { return }
        defer { Darwin.close(fd) }

        var ttl: UInt8 = 15
        setsockopt(fd, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, socklen_t(MemoryLayout<UInt8>.size))

        // Disable loopback so our own receive socket doesn't see our beacon. 260702-JB
        var loop: UInt8 = 0
        setsockopt(fd, IPPROTO_IP, IP_MULTICAST_LOOP, &loop, socklen_t(MemoryLayout<UInt8>.size))

        var dest = sockaddr_in()
        dest.sin_family = sa_family_t(AF_INET)
        dest.sin_port = in_port_t(1900).bigEndian
        dest.sin_addr.s_addr = inet_addr("239.255.255.250")

        let data = Array(payload.utf8)
        data.withUnsafeBytes { buf in
            withUnsafeBytes(of: &dest) { addrBuf in
                _ = Darwin.sendto(fd, buf.baseAddress, data.count, 0,
                                  addrBuf.baseAddress!.assumingMemoryBound(to: sockaddr.self),
                                  socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
    }


---

## Transport and framing

Ad-hoc text commands are **not** raw datagrams. The ASCII command is the
*payload* of an RTP/Eframe message — the same envelope Opus-Two uses for all
Enet UDP traffic. What marks a datagram as an ad-hoc command is the **chamber
byte = 108**, not the RTP payload type (which is always 100).

- **Port:** 5004 + 1 = **5005**
- **Direction:** client → console (command), console → sender (reply).
- **Reply routing:** the source IP of each datagram is captured and every reply
  is sent back to it, wrapped in the **same** Eframe envelope (chamber 108). A
  client must build the envelope to send and unwrap it to read replies.
- **Payload size limit:** the decoded payload lands in a 50-byte buffer, so keep
  the command text to **≤ 49 bytes**. Ad-hoc payloads are always < 256, so the
  length is a single byte (see below).
- **Side effect:** every inbound message is echoed to the console's corner
  display (`Corner_Message`), recognized or not.

### Datagram layout (ad-hoc / chamber 108)

| Off | Len | Field | Value |
|----|----|-------|-------|
| 0 | 1 | RTP V/P/X/CC | `0x80` (version 2) |
| 1 | 1 | RTP M/PT | `0x64` = payload type **100** (constant) |
| 2 | 2 | Sequence, big-endian | `O2_Blk.pass MOD 65536` |
| 4 | 4 | Timestamp, big-endian | tick count (`low32`) |
| 8 | 4 | SSRC, big-endian | `0x76543210` |
| 12 | 1 | Eframe chamber | **108** (`0x6C`) — ad-hoc marker |
| 13 | 1 | Payload length | `LEN(payload)` — one byte for ad-hoc |
| 14 | N | Payload | the ASCII command text; runs to end of datagram |

All multi-byte integer fields are **big-endian** (MSB sent first, LSB last). The
payload begins in the byte immediately after the length and is the remainder of
the datagram — there is no sub-opcode or terminator between the length and the
text.

> The single length byte is specific to ad-hoc frames. The generator writes a
> high length byte only when the payload exceeds 255 **or** the chamber is a real
> chamber (`1..chmbr_max`). 108 is outside that range and ad-hoc payloads are
> short, so these frames carry exactly one length byte. Real chamber frames (or
> any payload > 255) use a 2-byte big-endian length instead.

## Payload (command) syntax

This describes the **payload** only — the bytes from offset 14 onward. The
console strips the envelope before matching against these strings.

```
<PREFIX> <SUBCOMMAND> [number] [ "text" ]
```

- Recognized prefixes: `CA`, `GIO`, `RP`, `Flag`, `LDS`, `Query`, `Dev`.
- Numbers are decimal ASCII. **Leading zeros are optional** — the parser scans
  to the first digit and reads the run, so `1`, `01`, and `0001` are equivalent
  on input. (Zero-padded forms in the examples below just mirror the console's
  own convention.)
- Commands must be sent as the **exact strings** listed here. Matching is by
  literal substring at a fixed offset, so spelling and spacing matter.

## Acknowledgment model

Every **recognized** command produces exactly one reply — either the
information requested or a status token. An unrecognized message (bad prefix, or
a known prefix with an unknown subcommand) produces **no reply**.

| Reply | Meaning |
|-------|---------|
| `OK` | Command accepted and performed. |
| `Value Out of Range` | The numeric argument failed its range check; nothing was done. |
| `Bad Rename` | A rename argument had no opening quote or no closing quote; nothing was done. |
| `Track Locked` | `RP Record` refused because the track is write-protected. |
| `Busy` | `RP Play NNN` refused because a record/play/pause session is already active. |
| *info payload* | For query commands; see [Response payload formats](#response-payload-formats). |

---

## Command reference

### CA — combination action / console

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `CA Gen Can` | — | Fire the general cancel button. | `OK` |
| `CA Show Piston NNN` | piston, 1-based | Force/annunciate piston NNN. | `OK` · `Value Out of Range` (NNN ≤ 0) |
| `CA Show Range NNN` | piston, 1-based | Alias of `Show Piston` in this build. | `OK` · `Value Out of Range` |
| `CA Goto Folder NNN` | folder, 1-based | Select organist/folder NNN. | `OK` · `Value Out of Range` |
| `CA Goto Level NNN` | level, 1-based | Select memory level NNN (NNN = 1 is root). | `OK` · `Value Out of Range` |
| `CA Goto Local Level NNN` | level, 1-based | Select local memory level NNN. | `OK` · `Value Out of Range` |
| `CA Inc Mem Level` | — | Step memory level up. | `OK` |
| `CA Dec Mem Level` | — | Step memory level down. | `OK` |
| `CA Inc Local Mem Level` | — | Step local memory level up. | `OK` |
| `CA Dec Local Mem Level` | — | Step local memory level down. | `OK` |
| `CA Toggle Stop NNN` | stop, 1-based | Toggle reversible tab / stop NNN. | `OK` · `Value Out of Range` |
| `CA Rename Track NNNN "name"` | track + quoted name | Rename track NNNN, then restore the prior track pointer. | `OK` · `Value Out of Range` (NNNN ≤ 0) · `Bad Rename` |
| `CA Rename Folder NNNN "name"` | folder + quoted name | Rename folder NNNN, then restore the prior folder pointer and memory level. | `OK` · `Value Out of Range` · `Bad Rename` |
| `CA Transposer Neutral` | — | Reset transposer to neutral. | `OK` |
| `CA Transposer Up` | — | Transpose up one step. | `OK` |
| `CA Transposer Down` | — | Transpose down one step. | `OK` |
| `CA Get Folder Name NNN` | folder, 1-based | Return folder NNN's name (pointer restored after read). | `Fldr`-payload · `Value Out of Range` |

### GIO — general I/O buttons

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `GIO Tgl Button NNN` | button, 1-based | Toggle button NNN. | `OK` · `Value Out of Range` |
| `GIO Set Button NNN` | button, 1-based | Turn button NNN on. | `OK` · `Value Out of Range` |
| `GIO Clr Button NNN` | button, 1-based | Turn button NNN off. | `OK` · `Value Out of Range` |

### RP — record / playback

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `RP Btn Play` | — | Toggle play (play/stop). | `OK` |
| `RP Track Up` | — | Advance to the next track. | `OK` |
| `RP Track Down` | — | Go to the previous track. | `OK` |
| `RP Pause` | — | Toggle pause. | `OK` |
| `RP Record` | — | Toggle recording. | `OK` · `Track Locked` (write-protected) |
| `RP Toggle Track Lock` | — | Toggle the track write-enable. | `OK` |
| `RP Play NNN` | track, 1-based | Select track NNN and start playing, only if idle. | `OK` · `Value Out of Range` (NNN ≤ 0) · `Busy` (record/play/pause active) |

> Note: `RP Btn Play` and `RP Play NNN` are distinct. The parser tests `Btn Play`
> before `Play`, so `RP Btn Play` toggles, while `RP Play NNN` jumps to a track.

### Flag — configuration flags

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `Flag N` | flag index 0–31 | Set `config_flag[N]` TRUE. | `OK` · `Value Out of Range` (N < 0 or N > 31) |

### LDS — transport button lamps

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `LDS Buttons NNN` | **bitmask**, not an index | Set the six transport lamps from the bits of NNN. | `OK` |

Bit-to-lamp mapping (bit 0 = LSB):

| Bit | Lamp |
|-----|------|
| 0 | Down |
| 1 | Up |
| 2 | Trans |
| 3 | Track |
| 4 | Play |
| 5 | Rec |

Example: `LDS Buttons 20` → 20 = binary `010100` → Play (bit 4) and Trans
(bit 2) lit, all others off.

### Query — read-back

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `Query OLED` | — | Dump the 80-character display. | four `LDSL`-payloads (see below) |
| `Query Get Track Name NNN` | track, 1-based | Return track NNN's name. | `Tk`-payload · `Value Out of Range` |

### Dev — device control

| Command | Arg | Action | Replies |
|---------|-----|--------|---------|
| `Dev Reset` | — | Acknowledge, wait for the screen to clear, then hard-reset (SYSRESETREQ). | `OK` (sent **before** the reset) |

---

## Response payload formats

Each reply travels in the **same chamber-108 Eframe envelope** as a command; the
formats below are the payload (offset 14 onward) after you unwrap it. Reply
payloads are ASCII, `0X`-terminated, and never exceed the 30-byte send buffer
(so text fields are truncated to fit).

### Folder name — reply to `CA Get Folder Name`

```
F l d r N N N <name...>
```

- Bytes 0–3: literal `Fldr`
- Bytes 4–6: folder number, zero-padded to 3 digits
- Bytes 7…: folder name, truncated to fit (up to ~21 characters)

Example: `Fldr001Great Division`

### Track name — reply to `Query Get Track Name`

```
T k N N N <name...>
```

- Bytes 0–1: literal `Tk`
- Bytes 2–4: track number, zero-padded to 3 digits
- Bytes 5…: track name, truncated to fit (up to ~23 characters)

Example: `Tk007Sunday Postlude`

### OLED dump — reply to `Query OLED`

The 80-character display is returned as **four** separate datagrams, one per
20-character line:

```
L D S L d <20 characters>
```

- Bytes 0–3: literal `LDSL`
- Byte 4: line digit `1`–`4`
- Bytes 5–24: 20 characters of display content
- A client should collect all four lines (`LDSL1`…`LDSL4`) to reconstruct the
  full display.

---

## Notes and limits

- **Response number fields are 3 digits.** Folder and track numbers in the
  `Fldr`/`Tk` replies are formatted as exactly three digits (000–999). Numbers
  ≥ 1000 will render a non-digit in the hundreds position, even though the
  command parser itself accepts larger values.
- **Name lengths.** Track and folder names have 15 visible characters. The
  native setters use a 16-byte array including the `0X` terminator, so clients
  must right-pad shorter quoted rename values with spaces to exactly 15
  characters. Sending a variable-length value can trip the controller's
  checked array assignment. Query replies are additionally bounded by the
  30-byte send buffer.
- **Rename is pointer-safe.** Both rename commands save the current
  track/folder pointer (and, for folders, the exact memory level), apply the
  change, and force the pointer back — so renaming never leaves the console
  parked on the edited item.
- **Idempotent numeric input.** `Flag`, `Show Piston`, etc. read the first digit
  run after the keyword; surrounding spaces and leading zeros are ignored.
- **No reply ≠ failure to receive.** Silence means the message matched no known
  command or no known sender. There is currently no negative-acknowledge for 
  unknown commands.
- **One datagram, one command.** The handler drains all pending messages per
  cycle but treats each datagram independently; do not pack multiple commands
  into one datagram.

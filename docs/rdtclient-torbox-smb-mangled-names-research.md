# RDTClient/TorBox SMB Mangled Names Research

**Date**: August 17, 2026  
**Research Question**: Can RDTClient or TorBox create local download directories with names like `_OEF0E~2`, `_K511X~L`, `_PH2W9~Q`, or are those likely SMB/Samba mangled aliases?

---

## Executive Summary

**The directories with names like `_OEF0E~2`, `_K511X~L`, `_PH2W9~Q` are almost certainly SMB/Samba 8.3 filename mangling aliases, NOT directories created by RDTClient or TorBox.**

These names follow the characteristic pattern of Windows/Samba short filename generation when long filenames are presented to legacy SMB clients or when `mangled names = yes` is configured in Samba.

---

## Confirmed Facts

### 1. RDTClient v2.0.142 TorBox Folder-Name Fix

**Source**: [GitHub PR #1030](https://github.com/rogerfar/rdt-client/pull/1030) (merged August 3, 2026)

**Issue**: [GitHub Issue #978](https://github.com/rogerfar/rdt-client/issues/978) - "No files found are eligible for import in Radarr"

**Problem**: RDTClient was reporting incorrect folder names for TorBox downloads. Radarr would try to import from paths like:
```
/volume1/video/Download/Radarr/Twister (1996) UHDR cz sk en.mkv/
```
But the actual file was at:
```
/volume1/video/Download/Radarr/Twister (1996) UHDR cz sk en/Twister__1996__UHDR_cz_sk_en.mkv
```

**Root Cause**: In `QBittorrent.cs`, the `GetContentPathName()` method was incorrectly deriving the folder name from the file path for TorBox downloads.

**Fix**: The PR added a special case for TorBox in `GetContentPathName()`:
```csharp
if (torrent.ClientKind == Provider.TorBox)
{
    return torrent.RdName;
}
```

This ensures RDTClient uses the torrent name directly from TorBox's API (`torrent.RdName`) instead of trying to infer it from file paths.

**Key Insight**: RDTClient creates directories using the torrent name from the debrid provider's API, NOT mangled names.

### 2. SMB 8.3 Filename Mangling

**Source**: [Wikipedia - 8.3 filename](https://en.wikipedia.org/wiki/8.3_filename), [Samba Documentation](https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html)

**How it works**:
- When filenames exceed 8.3 format, they are truncated to 6 characters + tilde (`~`) + digit
- Special characters like `+`, spaces, and others are replaced with underscores (`_`)
- On Windows NT and later, if there are collisions (multiple files with same first 6 characters), the format uses: 2 characters + 4 hexadecimal digits + tilde + digit

**Examples from documentation**:
- `TextFile.Mine.txt` → `TEXTFI~1.TXT`
- `ver +1.2.text` → `VER_12~1.TEX`
- Collision example: `TextFile.Mine.txt` → `TE021F~1.TXT`

**The naming pattern in question**:
- `_OEF0E~2` - 6 chars + tilde + digit (matches standard 8.3 pattern)
- `_K511X~L` - 6 chars + tilde + letter (unusual - tilde should be followed by digit)
- `_PH2W9~Q` - 6 chars + tilde + letter (unusual)

**Analysis**: The patterns `_K511X~L` and `_PH2W9~Q` with letters after the tilde are NOT standard Windows 8.3 naming. Standard Windows uses digits (1-9, then 0 for 10+). However, Samba can be configured with different mangling characters and algorithms.

### 3. RDTClient Directory Creation Behavior

**Source**: [RDTClient Source Code](https://github.com/rogerfar/rdt-client/blob/main/server/RdtClient.Service/Services/QBittorrent.cs)

RDTClient creates download directories based on:
1. **For TorBox**: Uses `torrent.RdName` directly (the name from TorBox's API)
2. **For other providers**: Derives folder name from file paths or torrent name
3. **Path construction**: `{DownloadPath}/{Category}/{ContentPathName}/`

**RDTClient does NOT create mangled names** - it uses the names as provided by the debrid service or derives them from file paths.

### 4. TorBox API Behavior

**Source**: [TorBox Documentation](https://support.torbox.app/en/articles/10167535-how-to-setup-rdtclient-with-torbox-docker)

TorBox provides torrent metadata including:
- `name`: The torrent name as reported by the tracker
- `files`: List of files with their paths

TorBox does NOT mangle filenames - it returns the original torrent metadata.

---

## Inference and Analysis

### Why These Names Appear

The directories with names like `_OEF0E~2` are likely created by:

1. **Samba/SMB server** when presenting long filenames to legacy clients
2. **Windows filesystem** generating 8.3 short names for backward compatibility
3. **Samba configuration** with `mangled names = yes` (the default)

### The Underscore Prefix Pattern

The leading underscore (`_`) in `_OEF0E~2` is unusual for standard Windows 8.3 naming. This could indicate:
- **Samba's custom mangling algorithm** (different from Windows)
- **A different character being used as the mangling character** (configurable in smb.conf)
- **FAT/VFAT filesystem behavior** on the NAS

### How to Verify

To check if these are SMB mangled names:

1. **On the NAS/Samba server**:
   ```bash
   # Check Samba configuration
   testparm -s | grep -i mangle
   
   # List files with short names
   smbclient //server/share -U user -c "ls"
   ```

2. **On a Windows client**:
   ```cmd
   # List short filenames
   dir /x
   ```

3. **Check the actual filesystem**:
   ```bash
   # On Linux/NAS
   ls -la /path/to/share/
   ```

---

## Practical Fixes

### If You Want to Disable SMB Name Mangling

**On Samba server** (`/etc/samba/smb.conf`):
```ini
[global]
   mangled names = no

[share]
   mangled names = no
```

Then restart Samba:
```bash
systemctl restart smbd
```

### If You Want to Use Long Names in RDTClient

**Ensure RDTClient is configured with**:
- `MappedPath`: Should match the actual path on the filesystem
- `DownloadPath`: Should be the path RDTClient uses to create directories

**For SMB CSI in Kubernetes**:
- Use static PVs with correct paths
- Ensure the SMB share is mounted with correct options

### If You Need to Find the Original Filenames

**On Linux**:
```bash
# Find files with mangled names and their real names
find /path -name "*~*" -exec ls -la {} \;
```

**On Windows**:
```cmd
# List short and long names
dir /x C:\path\to\share
```

---

## References

1. **RDTClient PR #1030**: https://github.com/rogerfar/rdt-client/pull/1030
2. **RDTClient Issue #978**: https://github.com/rogerfar/rdt-client/issues/978
3. **RDTClient Releases**: https://github.com/rogerfar/rdt-client/releases
4. **Wikipedia - 8.3 filename**: https://en.wikipedia.org/wiki/8.3_filename
5. **Samba Documentation**: https://www.samba.org/samba/docs/current/man-html/smb.conf.5.html
6. **TorBox Setup Guide**: https://support.torbox.app/en/articles/10167535-how-to-setup-rdtclient-with-torbox-docker

---

## Conclusion

**The directories with names like `_OEF0E~2`, `_K511X~L`, `_PH2W9~Q` are SMB/Samba mangled aliases**, not directories created by RDTClient or TorBox. 

RDTClient v2.0.142 fixed a TorBox folder-name reporting issue, but this was about RDTClient incorrectly deriving folder names from file paths, NOT about creating mangled names.

To resolve this issue:
1. Disable `mangled names` in Samba configuration if not needed
2. Ensure RDTClient's `MappedPath` matches the actual filesystem path
3. Use long filenames consistently across all components

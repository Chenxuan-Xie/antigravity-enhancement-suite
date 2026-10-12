param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("read", "write")]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [string]$Target = "gemini:antigravity",

    [Parameter(Mandatory=$false)]
    [string]$UserName = "antigravity",

    [Parameter(Mandatory=$false)]
    [string]$PayloadBase64 = ""
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class AgyWinCred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, [In] uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CredFree([In] IntPtr cred);

    public static string ReadBase64(string target) {
        IntPtr credPtr;
        if (!CredRead(target, 1, 0, out credPtr)) {
            return null;
        }
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) {
                return "";
            }
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);
            return Convert.ToBase64String(bytes);
        } finally {
            CredFree(credPtr);
        }
    }

    public static void WriteBase64(string target, string userName, string base64Blob) {
        byte[] bytes = Convert.FromBase64String(base64Blob);
        IntPtr blobPtr = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blobPtr, bytes.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Flags = 0;
            cred.Type = 1; // CRED_TYPE_GENERIC
            cred.TargetName = target;
            cred.Comment = null;
            cred.CredentialBlobSize = (uint)bytes.Length;
            cred.CredentialBlob = blobPtr;
            cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE
            cred.AttributeCount = 0;
            cred.Attributes = IntPtr.Zero;
            cred.TargetAlias = null;
            cred.UserName = userName;

            if (!CredWrite(ref cred, 0)) {
                int err = Marshal.GetLastWin32Error();
                throw new Exception("CredWriteW failed with Win32 error code: " + err);
            }
        } finally {
            Marshal.FreeHGlobal(blobPtr);
        }
    }
}
"@

if ($Action -eq "read") {
    $res = [AgyWinCred]::ReadBase64($Target)
    if ($null -eq $res) {
        Write-Output "NOT_FOUND"
    } else {
        Write-Output ("OK:" + $res)
    }
} elseif ($Action -eq "write") {
    if ([string]::IsNullOrEmpty($PayloadBase64)) {
        throw "PayloadBase64 is required for write action"
    }
    [AgyWinCred]::WriteBase64($Target, $UserName, $PayloadBase64)
    Write-Output "OK"
}

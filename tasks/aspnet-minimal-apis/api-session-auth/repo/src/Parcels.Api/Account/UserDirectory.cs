using System.Security.Cryptography;
using System.Text;

namespace Parcels.Api.Account;

public sealed record AppUser(string UserName, string DisplayName, string[] Roles);

/// <summary>Stand-in for the identity service: two staff accounts with fixed demo passwords.</summary>
public sealed class UserDirectory
{
    private readonly Dictionary<string, (byte[] Hash, AppUser User)> _users = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ana"] = (Hash("ana-demo-password"), new AppUser("ana", "Ana Ribeiro", ["admin"])),
        ["rui"] = (Hash("rui-demo-password"), new AppUser("rui", "Rui Costa", ["clerk"])),
    };

    public AppUser? Verify(string? userName, string? password)
    {
        if (userName is null || password is null || !_users.TryGetValue(userName, out var entry))
            return null;
        return CryptographicOperations.FixedTimeEquals(entry.Hash, Hash(password)) ? entry.User : null;
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}

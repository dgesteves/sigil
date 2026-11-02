using System.Net;
using System.Text.Json;

namespace Parcels.Tests.Hidden;

/// <summary>Reads an RFC 9457 validation problem and looks up field keys case-insensitively.</summary>
internal sealed class ValidationProblem
{
    public required Dictionary<string, string[]> Errors { get; init; }

    public static async Task<ValidationProblem> ReadAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(
            response.StatusCode == HttpStatusCode.BadRequest,
            $"expected 400, got {(int)response.StatusCode}: {body}");
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(body);
        Assert.True(
            doc.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object,
            $"problem details without an errors map: {body}");

        var map = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in errors.EnumerateObject())
        {
            Assert.Equal(JsonValueKind.Array, field.Value.ValueKind);
            var messages = field.Value.EnumerateArray().Select(m => m.GetString() ?? "").ToArray();
            Assert.NotEmpty(messages);
            Assert.All(messages, m => Assert.False(string.IsNullOrWhiteSpace(m)));
            map[field.Name] = messages;
        }
        return new ValidationProblem { Errors = map };
    }

    public void Has(params string[] keys)
    {
        foreach (var key in keys)
            Assert.True(
                Errors.ContainsKey(key),
                $"expected an error for '{key}', got: {string.Join(", ", Errors.Keys)}");
    }

    public void Lacks(params string[] keys)
    {
        foreach (var key in keys)
            Assert.False(
                Errors.ContainsKey(key),
                $"unexpected error for '{key}': {string.Join(" | ", Errors.GetValueOrDefault(key) ?? [])}");
    }
}

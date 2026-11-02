using Parcels.Api.Customers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
// Built-in minimal API validation (.NET 10): DataAnnotations on handler parameters and on the
// records they bind, recursively, with failures returned as 400 validation problem details.
builder.Services.AddValidation();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<CustomerStore>();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }));
app.MapCustomers();

app.Run();

public partial class Program;

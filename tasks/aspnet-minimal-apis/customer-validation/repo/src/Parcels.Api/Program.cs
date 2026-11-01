using Parcels.Api.Customers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<CustomerStore>();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }));
app.MapCustomers();

app.Run();

public partial class Program;

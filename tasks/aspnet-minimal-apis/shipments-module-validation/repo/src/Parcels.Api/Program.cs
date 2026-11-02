using Parcels.Api.Customers;
using Parcels.Shipments;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
// Built-in minimal API validation: DataAnnotations on handler parameters and the records they bind.
builder.Services.AddValidation();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<CustomerStore>();
builder.Services.AddShipmentsModule();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }));
app.MapCustomers();
app.MapShipmentsModule();

app.Run();

public partial class Program;

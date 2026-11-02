using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Parcels.Shipments;

public static class ShipmentsModule
{
    public static IServiceCollection AddShipmentsModule(this IServiceCollection services)
    {
        // The validation source generator only sees endpoints and types in the assembly that calls
        // AddValidation. The host's call covers the host's endpoints, not this module's, so the
        // module registers its own (the registrations compose).
        services.AddValidation();
        services.AddSingleton<Pricing>();
        services.AddSingleton<ShipmentBook>();
        return services;
    }

    public static IEndpointRouteBuilder MapShipmentsModule(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/shipments").WithTags("Shipments");

        group.MapGet("/quote", GetQuote);
        group.MapGet("/", (ShipmentBook book) => TypedResults.Ok(book.All()));
        group.MapGet("/{id}", GetShipment);
        group.MapPost("/", BookShipment);

        return app;
    }

    private static Ok<Quote> GetQuote(
        [Range(1, 30000)] int weightGrams,
        [AllowedValues("standard", "express", "same-day")] string service,
        Pricing pricing) =>
        TypedResults.Ok(new Quote(service, weightGrams, pricing.PriceCents(service, weightGrams)));

    private static Results<Ok<Shipment>, NotFound> GetShipment(string id, ShipmentBook book) =>
        book.Find(id) is { } shipment ? TypedResults.Ok(shipment) : TypedResults.NotFound();

    private static Created<Shipment> BookShipment(BookShipmentRequest request, ShipmentBook book)
    {
        var shipment = book.Book(request);
        return TypedResults.Created($"/api/shipments/{shipment.Id}", shipment);
    }
}

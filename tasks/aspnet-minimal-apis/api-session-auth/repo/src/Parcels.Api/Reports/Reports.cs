using System.Text;
using Parcels.Api.Shipments;

namespace Parcels.Api.Reports;

public static class ReportEndpoints
{
    public static IEndpointRouteBuilder MapReports(this IEndpointRouteBuilder app)
    {
        // Finance export, admins only.
        app.MapGet("/api/reports/daily", (ShipmentStore store) =>
        {
            var csv = new StringBuilder("id,customer_id,status,price_cents,refunded_cents\n");
            foreach (var s in store.All())
                csv.Append($"{s.Id},{s.CustomerId},{s.Status},{s.PriceCents},{s.RefundedCents}\n");
            return Results.Text(csv.ToString(), "text/csv");
        });

        return app;
    }
}

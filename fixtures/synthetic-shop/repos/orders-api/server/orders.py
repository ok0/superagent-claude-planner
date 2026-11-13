import json
import uuid


def build_order(customer_name, subtotal_cents, tax_cents):
    total_cents = subtotal_cents + tax_cents
    return {
        "id": str(uuid.uuid4()),
        "customerName": customer_name,
        "totals": {
            "subtotalCents": subtotal_cents,
            "totalCents": total_cents,
        },
    }


def order_placed_event(order):
    return {
        "orderId": order["id"],
        "customerName": order["customerName"],
        "totalCents": order["totals"]["totalCents"],
    }


def handle_place_order(payload):
    order = build_order(payload["customerName"], payload["subtotalCents"], payload.get("taxCents", 0))
    event = order_placed_event(order)
    print(json.dumps(event))
    return order

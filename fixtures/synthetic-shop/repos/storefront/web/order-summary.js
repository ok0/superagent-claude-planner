export async function renderOrderSummary(container, orderId) {
  const response = await fetch(`/orders/${encodeURIComponent(orderId)}`)
  if (!response.ok) {
    container.textContent = `Order ${orderId} could not be loaded`
    return
  }
  const order = await response.json()
  container.innerHTML = ''
  const name = document.createElement('p')
  name.textContent = `Customer: ${order.customerName}`
  const total = document.createElement('p')
  total.textContent = `Total (cents): ${order.totals.totalCents}`
  container.append(name, total)
}

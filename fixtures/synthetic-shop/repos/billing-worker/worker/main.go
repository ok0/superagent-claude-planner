package main

import (
	"encoding/json"
	"log"
)

type OrderPlaced struct {
	OrderID      string `json:"orderId"`
	CustomerName string `json:"customerName"`
	TotalCents   int    `json:"totalCents"`
}

func handleOrderPlaced(raw []byte) error {
	var event OrderPlaced
	if err := json.Unmarshal(raw, &event); err != nil {
		return err
	}
	log.Printf("charge order=%s customer=%s amount_cents=%d", event.OrderID, event.CustomerName, event.TotalCents)
	return nil
}

func main() {
	payload := []byte(`{"orderId":"o-1","customerName":"Example Customer","totalCents":1200}`)
	if err := handleOrderPlaced(payload); err != nil {
		log.Fatal(err)
	}
}

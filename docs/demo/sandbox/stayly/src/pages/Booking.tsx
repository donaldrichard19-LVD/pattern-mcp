import { useState } from "react";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";

export function Booking() {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <Card
        title="Lakeside cabin"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary">Message host</Button>
            {!cancelled && (
              <Button variant="danger" onClick={() => setConfirmingCancel(true)}>Cancel booking</Button>
            )}
          </div>
        }
      >
        <p>Oct 14 to Oct 18 · 2 guests</p>
        <div className="mt-2">
          {cancelled ? <Badge tone="neutral">Cancelled</Badge> : <Badge tone="success">Confirmed</Badge>}
        </div>
      </Card>
      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this booking?"
        message="Your stay at Lakeside cabin (Oct 14 to Oct 18) will be cancelled. This can't be undone."
        confirmLabel="Cancel booking"
        onConfirm={() => {
          setCancelled(true);
          setConfirmingCancel(false);
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
    </main>
  );
}

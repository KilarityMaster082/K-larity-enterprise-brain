"use client";
// Owner task: EB-91 UI design system — interactive components: tabs, segmented control, table, sheet, modal, toast.
import { Card, DataTable, Modal, Money, Segmented, Sheet, TabPanel, Tabs, useToast, type Column } from "@klarity/ui";
import { useState } from "react";

interface Row {
  id: string;
  item: string;
  amount: number;
  status: string;
}

const ROWS: Row[] = [
  { id: "1", item: "Facade", amount: 2400000, status: "Over" },
  { id: "2", item: "MEP", amount: 2400000, status: "On budget" },
  { id: "3", item: "Site labour", amount: 1810000, status: "Over" },
];

export function InteractiveDemos() {
  const [tab, setTab] = useState("one");
  const [seg, setSeg] = useState<"a" | "b" | "c">("a");
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);
  const toast = useToast();
  const cols: Column<Row>[] = [
    { key: "item", header: "Item", cell: (r) => r.item, sort: (r) => r.item, text: (r) => r.item },
    { key: "status", header: "Status", cell: (r) => r.status, sort: (r) => r.status },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => <Money amount={r.amount} />, sort: (r) => r.amount },
  ];
  return (
    <>
      <Card title="Tabs and segmented control">
        <Tabs label="Example tabs" value={tab} onChange={setTab} tabs={[{ id: "one", label: "First" }, { id: "two", label: "Second", count: 3 }]} />
        <TabPanel id="one" active={tab === "one"}>
          <p>Arrow keys move between tabs.</p>
        </TabPanel>
        <TabPanel id="two" active={tab === "two"}>
          <p>Second panel.</p>
        </TabPanel>
        <div style={{ marginTop: "var(--s-4)" }}>
          <Segmented label="Example filter" value={seg} onChange={setSeg} options={[{ value: "a", label: "All" }, { value: "b", label: "Needs attention" }, { value: "c", label: "On track" }]} />
        </div>
      </Card>
      <Card title="Data table">
        <DataTable rows={ROWS} columns={cols} rowKey={(r) => r.id} caption="Example table" searchPlaceholder="Filter items" />
      </Card>
      <Card title="Overlays and feedback">
        <div className="row">
          <button type="button" className="btn" onClick={() => setSheet(true)}>
            Open side sheet
          </button>
          <button type="button" className="btn" onClick={() => setModal(true)}>
            Open modal
          </button>
          <button type="button" className="btn" onClick={() => toast("Saved. This is a toast.")}>
            Show toast
          </button>
          <button type="button" className="btn btn-danger" onClick={() => toast("Something went wrong.", "danger")}>
            Show error toast
          </button>
        </div>
      </Card>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Side sheet">
        <p>Used for sources and details. Esc closes it and focus returns to the button that opened it.</p>
      </Sheet>
      <Modal open={modal} onClose={() => setModal(false)} title="Modal">
        <p>Used for confirmations and short forms.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setModal(false)}>
            OK
          </button>
        </div>
      </Modal>
    </>
  );
}

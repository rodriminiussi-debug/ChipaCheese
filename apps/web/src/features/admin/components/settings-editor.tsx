"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { updateSettingAction } from "../actions";

export function SettingRow({
  settingKey,
  value,
  description,
}: {
  settingKey: string;
  value: unknown;
  description: string | null;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value));
  const save = useAction(updateSettingAction, { success: "Parámetro actualizado" });
  const dirty = draft !== JSON.stringify(value);
  return (
    <TableRow>
      <TableCell>
        <div className="font-mono text-xs">{settingKey}</div>
        <div className="text-muted-foreground text-xs">{description}</div>
      </TableCell>
      <TableCell className="w-64">
        <Input
          aria-label={settingKey}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="font-mono"
        />
      </TableCell>
      <TableCell className="w-24 text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || save.pending}
          onClick={() => save.run({ key: settingKey, value: draft })}
        >
          Guardar
        </Button>
      </TableCell>
    </TableRow>
  );
}

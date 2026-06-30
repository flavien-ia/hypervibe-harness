"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription } from "~/components/ui/alert";

export default function ContactPage() {
  const t = useTranslations("contact");
  const schema = z.object({
    name: z.string().min(1, t("errors.nameRequired")).max(100),
    email: z.string().email(t("errors.emailInvalid")),
    message: z.string().min(1, t("errors.messageRequired")).max(5000),
    website: z.string().max(200).optional(),
  });
  type FormData = z.infer<typeof schema>;

  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", message: "", website: "" },
  });
  const mutation = api.contact.send.useMutation({
    onSuccess: () => {
      setState("success");
      form.reset();
    },
    onError: (err) => {
      setState("error");
      setErrorMsg(
        err.data?.code === "TOO_MANY_REQUESTS" ? t("errors.rateLimit") : t("errors.generic"),
      );
    },
  });

  return (
    <main className="container mx-auto max-w-xl py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === "success" && (
            <Alert className="mb-4 border-green-500 text-green-700">
              <AlertDescription>{t("success")}</AlertDescription>
            </Alert>
          )}
          {state === "error" && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
            <div>
              <Label htmlFor="name">{t("name")}</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="mt-1 text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" type="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="mt-1 text-sm text-red-500">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="message">{t("message")}</Label>
              <Textarea id="message" rows={6} {...form.register("message")} />
              {form.formState.errors.message && (
                <p className="mt-1 text-sm text-red-500">{form.formState.errors.message.message}</p>
              )}
            </div>
            {/* Honeypot - invisible for humans */}
            <div style={{ position: "absolute", left: "-9999px", opacity: 0 }} aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                {...form.register("website")}
              />
            </div>
            <Button type="submit" disabled={mutation.isPending} className="cursor-pointer">
              {mutation.isPending ? t("sending") : t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

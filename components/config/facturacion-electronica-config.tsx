"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, CheckCircle2, FileBadge, KeyRound, Landmark, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getFeConfig,
  saveFeConfig,
  saveFeSecretos,
  type FeConfig,
  type FeConfigEditable,
} from "@/lib/cloudflare-api";

const ESTADOS: Record<FeConfig["status"], { texto: string; clase: string }> = {
  borrador: { texto: "Faltan datos", clase: "bg-gray-100 text-gray-700" },
  listo_pruebas: { texto: "Lista para las pruebas de la DIAN", clase: "bg-amber-100 text-amber-800" },
  habilitado: { texto: "Habilitada por la DIAN", clase: "bg-emerald-100 text-emerald-800" },
  produccion: { texto: "Facturando electrónicamente", clase: "bg-emerald-100 text-emerald-800" },
};

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }) : "—";

function diasHasta(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function leerArchivoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

function Campo({
  id,
  label,
  ayuda,
  children,
}: {
  id: string;
  label: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {ayuda && <p className="text-xs text-gray-500">{ayuda}</p>}
    </div>
  );
}

/**
 * Facturación electrónica DIAN (modo "software propio"). El dueño registra los
 * datos del RUT, el software que creó en el portal de la DIAN y la firma digital
 * (.p12 de Maticerts). Con eso la tienda queda lista para el set de pruebas.
 * Solo la ve el dueño: a los demás el Worker les responde 403 y la tarjeta no aparece.
 */
export function FacturacionElectronicaConfig() {
  const { getToken } = useAuth();
  const [config, setConfig] = useState<FeConfig | null>(null);
  const [hidden, setHidden] = useState(false);
  const [form, setForm] = useState<FeConfigEditable>({});
  const [pin, setPin] = useState("");
  const [p12, setP12] = useState<File | null>(null);
  const [p12Clave, setP12Clave] = useState("");
  const [guardando, setGuardando] = useState<"datos" | "pin" | "firma" | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const archivoRef = useRef<HTMLInputElement>(null);

  const cargar = (c: FeConfig) => {
    setConfig(c);
    setForm({
      tipo_persona: c.tipo_persona,
      nit: c.nit,
      dv: c.dv,
      razon_social: c.razon_social,
      nombre_comercial: c.nombre_comercial,
      responsabilidades: c.responsabilidades,
      tributo: c.tributo,
      municipio_codigo: c.municipio_codigo,
      municipio: c.municipio,
      departamento: c.departamento,
      departamento_codigo: c.departamento_codigo,
      direccion: c.direccion,
      telefono: c.telefono,
      correo: c.correo,
      software_id: c.software_id,
      test_set_id: c.test_set_id,
    });
  };

  useEffect(() => {
    getFeConfig(getToken)
      .then(cargar)
      .catch(() => setHidden(true));
  }, [getToken]);

  if (hidden) return null;

  const set = (campo: keyof FeConfigEditable) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));
  const valor = (campo: keyof FeConfigEditable) => (form[campo] as string | null | undefined) ?? "";

  const guardarDatos = async () => {
    setGuardando("datos");
    try {
      cargar(await saveFeConfig(form, getToken));
      toast.success("Datos de facturación guardados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };

  const guardarPin = async () => {
    setGuardando("pin");
    try {
      const r = await saveFeSecretos({ pin });
      cargar(r.config);
      setPin("");
      toast.success("PIN guardado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el PIN");
    } finally {
      setGuardando(null);
    }
  };

  const guardarFirma = async () => {
    if (!p12) return;
    setGuardando("firma");
    try {
      const r = await saveFeSecretos({ p12Base64: await leerArchivoBase64(p12), p12Clave });
      cargar(r.config);
      setAvisos(r.avisos);
      setP12(null);
      setP12Clave("");
      if (archivoRef.current) archivoRef.current.value = "";
      toast.success("Firma digital guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la firma");
    } finally {
      setGuardando(null);
    }
  };

  const estado = config ? ESTADOS[config.status] : null;
  const venceEn = diasHasta(config?.certificado?.vence);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Landmark className="h-5 w-5 text-brand" />
          Facturación electrónica DIAN
          {estado && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${estado.clase}`}>{estado.texto}</span>
          )}
        </CardTitle>
        <CardDescription>
          posib emite tus facturas electrónicas directamente ante la DIAN, firmadas con la firma digital de tu
          tienda. Llena los tres pasos; cuando no falte nada, hacemos las pruebas de habilitación con la DIAN.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        {config && config.faltantes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Falta:</p>
            <p>{config.faltantes.join(" · ")}</p>
          </div>
        )}

        {/* 1. Datos del RUT */}
        <section className="space-y-4">
          <h3 className="font-semibold">1. Datos del RUT</h3>
          <p className="text-sm text-gray-500">Escríbelos exactamente como aparecen en el RUT de la tienda.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="fe-tipo" label="Tipo de persona">
              <select id="fe-tipo" className={SELECT} value={valor("tipo_persona")} onChange={set("tipo_persona")}>
                <option value="">Elegir…</option>
                <option value="2">Persona natural</option>
                <option value="1">Persona jurídica (empresa)</option>
              </select>
            </Campo>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <Campo id="fe-nit" label="NIT o cédula" ayuda="Sin puntos ni dígito de verificación">
                <Input id="fe-nit" inputMode="numeric" value={valor("nit")} onChange={set("nit")} />
              </Campo>
              <Campo id="fe-dv" label="DV">
                <Input id="fe-dv" inputMode="numeric" maxLength={1} value={valor("dv")} onChange={set("dv")} />
              </Campo>
            </div>
            <Campo id="fe-razon" label="Nombre o razón social">
              <Input id="fe-razon" value={valor("razon_social")} onChange={set("razon_social")} />
            </Campo>
            <Campo id="fe-comercial" label="Nombre comercial (opcional)">
              <Input id="fe-comercial" value={valor("nombre_comercial")} onChange={set("nombre_comercial")} />
            </Campo>
            <Campo
              id="fe-resp"
              label="Responsabilidades"
              ayuda="Casilla 53 del RUT, separadas por ; (ej. O-13;O-15). Si no tienes, escribe R-99-PN"
            >
              <Input id="fe-resp" value={valor("responsabilidades")} onChange={set("responsabilidades")} />
            </Campo>
            <Campo id="fe-iva" label="¿Responsable de IVA?">
              <select id="fe-iva" className={SELECT} value={valor("tributo")} onChange={set("tributo")}>
                <option value="">Elegir…</option>
                <option value="ZZ">No responsable de IVA</option>
                <option value="01">Sí, responsable de IVA</option>
                <option value="04">Solo impuesto al consumo (INC)</option>
                <option value="ZA">IVA e INC</option>
              </select>
            </Campo>
            <Campo id="fe-dpto" label="Departamento">
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <Input
                  id="fe-dpto-cod"
                  aria-label="Código DANE del departamento"
                  placeholder="86"
                  inputMode="numeric"
                  maxLength={2}
                  value={valor("departamento_codigo")}
                  onChange={set("departamento_codigo")}
                />
                <Input id="fe-dpto" placeholder="Putumayo" value={valor("departamento")} onChange={set("departamento")} />
              </div>
            </Campo>
            <Campo id="fe-mun" label="Municipio" ayuda="El código DANE aparece en el RUT (5 dígitos)">
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <Input
                  id="fe-mun-cod"
                  aria-label="Código DANE del municipio"
                  placeholder="86001"
                  inputMode="numeric"
                  maxLength={5}
                  value={valor("municipio_codigo")}
                  onChange={set("municipio_codigo")}
                />
                <Input id="fe-mun" placeholder="Mocoa" value={valor("municipio")} onChange={set("municipio")} />
              </div>
            </Campo>
            <Campo id="fe-dir" label="Dirección">
              <Input id="fe-dir" value={valor("direccion")} onChange={set("direccion")} />
            </Campo>
            <Campo id="fe-tel" label="Teléfono (opcional)">
              <Input id="fe-tel" inputMode="tel" value={valor("telefono")} onChange={set("telefono")} />
            </Campo>
            <Campo id="fe-correo" label="Correo de facturación" ayuda="El mismo que registraste en la DIAN">
              <Input id="fe-correo" type="email" value={valor("correo")} onChange={set("correo")} />
            </Campo>
          </div>
        </section>

        {/* 2. Software en la DIAN */}
        <section className="space-y-4">
          <h3 className="font-semibold">2. Software registrado en la DIAN</h3>
          <p className="text-sm text-gray-500">
            En el portal de la DIAN: Facturando electrónicamente → Habilitación → <b>Software propio</b> → registra
            el software con el nombre <b>posib</b>. La DIAN te muestra estos datos.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="fe-swid" label="Identificador del software (Software ID)">
              <Input
                id="fe-swid"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={valor("software_id")}
                onChange={set("software_id")}
              />
            </Campo>
            <Campo id="fe-testset" label="Identificador del set de pruebas (TestSetId)">
              <Input
                id="fe-testset"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={valor("test_set_id")}
                onChange={set("test_set_id")}
              />
            </Campo>
          </div>
          <Button type="button" onClick={guardarDatos} disabled={guardando !== null} className="cursor-pointer">
            {guardando === "datos" ? "Guardando..." : "Guardar datos"}
          </Button>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border p-4">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="fe-pin" className="flex items-center gap-1.5">
                <KeyRound className="h-4 w-4" /> PIN del software
                {config?.tiene_pin && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Guardado" />}
              </Label>
              <Input
                id="fe-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder={config?.tiene_pin ? "Guardado (escribe para cambiarlo)" : "El PIN que elegiste en la DIAN"}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={guardarPin}
              disabled={!pin || guardando !== null}
              className="cursor-pointer"
            >
              {guardando === "pin" ? "Guardando..." : "Guardar PIN"}
            </Button>
          </div>
        </section>

        {/* 3. Firma digital */}
        <section className="space-y-4">
          <h3 className="font-semibold">3. Firma digital</h3>
          <p className="text-sm text-gray-500">
            Es el archivo <b>.p12</b> de Maticerts a nombre de la tienda (persona natural o empresa, como el RUT), con
            la clave que llega junto con él. Se guarda cifrado; nadie puede descargarlo.
          </p>

          {config?.certificado && (
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <FileBadge className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <div className="text-sm">
                <p className="font-medium">{config.certificado.titular}</p>
                <p className="text-gray-500">
                  Vigente hasta el {fecha(config.certificado.vence)}
                  {venceEn !== null && venceEn <= 30 && (
                    <span className="ml-1 font-medium text-red-600">
                      {venceEn > 0 ? `(vence en ${venceEn} días: hay que renovarla)` : "(vencida: la DIAN rechazará las facturas)"}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {avisos.map((a) => (
            <div key={a} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{a}</span>
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="fe-p12" label={config?.certificado ? "Reemplazar por una firma nueva" : "Archivo .p12"}>
              <Input
                id="fe-p12"
                ref={archivoRef}
                type="file"
                accept=".p12,.pfx,application/x-pkcs12"
                onChange={(e) => setP12(e.target.files?.[0] ?? null)}
                className="cursor-pointer"
              />
            </Campo>
            <Campo id="fe-p12-clave" label="Clave de la firma" ayuda="El PIN que te dio Maticerts con el archivo">
              <Input
                id="fe-p12-clave"
                type="password"
                autoComplete="off"
                value={p12Clave}
                onChange={(e) => setP12Clave(e.target.value)}
              />
            </Campo>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={guardarFirma}
            disabled={!p12 || guardando !== null}
            className="cursor-pointer"
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {guardando === "firma" ? "Verificando la firma..." : "Subir firma digital"}
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}

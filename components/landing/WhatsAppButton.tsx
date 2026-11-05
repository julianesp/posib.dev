"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";

export default function WhatsAppButton() {
  const handleWhatsAppClick = () => {
    // Reemplaza con tu número de WhatsApp (incluye código de país sin + ni espacios)
    const phoneNumber = "573174503604"; // Ejemplo: Colombia
    const message = encodeURIComponent(
      "Hola, me gustaría saber más sobre el sistema POS",
    );
    window.open(`https://wa.me/${phoneNumber}?text=${message}`, "_blank");
  };

  return (
    <Button
      onClick={handleWhatsAppClick}
      // Pegado a la esquina inferior izquierda; en iPhone respeta la barra de inicio.
      className="fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 z-50 rounded-full w-14 h-14 shadow-2xl bg-green-500 hover:bg-green-600 transition-all hover:scale-110 animate-bounce"
      size="icon"
      aria-label="Contactar por WhatsApp"
    >
      {/* <MessageCircle className="h-6 w-6 text-white" /> */}
      <Image
        src="https://pub-c0883d14d3e84a69bf84546fa108aa0b.r2.dev/socialmedia/social%20(1).png"
        alt="Icono Whatsapp"
        width={50}
        height={50}
      />
    </Button>
  );
}

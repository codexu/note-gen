"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface Tab {
  title: string;
  icon: LucideIcon;
  type?: never;
}

interface Separator {
  type: "separator";
  title?: never;
  icon?: never;
}

type TabItem = Tab | Separator;

interface ExpandableTabsProps {
  tabs: TabItem[];
  className?: string;
  activeColor?: string;
  onChange?: (index: number | null) => void;
  selected?: number | null;
}

const buttonVariants = {
  initial: {
    gap: 0,
    paddingLeft: ".375rem",
    paddingRight: ".375rem",
  },
  animate: (isSelected: boolean) => ({
    gap: isSelected ? ".375rem" : 0,
    paddingLeft: isSelected ? "0.75rem" : ".375rem",
    paddingRight: isSelected ? "0.75rem" : ".375rem",
  }),
};

const spanVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

const transition = { delay: 0.1, type: "spring" as const, bounce: 0, duration: 0.6 };

export function ExpandableTabs({
  tabs,
  className,
  activeColor = "text-primary",
  onChange,
  selected: controlledSelected,
}: ExpandableTabsProps) {
  const [internalSelected, setInternalSelected] = React.useState<number | null>(null);
  const outsideClickRef = React.useRef(null);

  // Support controlled mode
  const selected = controlledSelected !== undefined ? controlledSelected : internalSelected;

  useOnClickOutside(outsideClickRef, () => {
    if (controlledSelected === undefined) {
      setInternalSelected(null);
    }
    onChange?.(null);
  });

  const handleSelect = (index: number) => {
    if (controlledSelected === undefined) {
      setInternalSelected(index);
    }
    onChange?.(index);
  };

  const Separator = () => (
    <div className="mx-1 h-5 w-[1px] bg-border" aria-hidden="true" />
  );

  return (
    <div
      ref={outsideClickRef}
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-xl border bg-background p-0.5",
        className
      )}
    >
      {tabs.map((tab, index) => {
        if (tab.type === "separator") {
          return <Separator key={`separator-${index}`} />;
        }

        const Icon = tab.icon;
        return (
          <motion.button
            key={tab.title}
            variants={buttonVariants}
            initial={false}
            animate="animate"
            custom={selected === index}
            onClick={() => handleSelect(index)}
            transition={transition}
            className={cn(
              "relative flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-300",
              selected === index
                ? cn("bg-muted", activeColor)
                : "text-muted-foreground hover:bg-muted hover:text-foreground opacity-70"
            )}
          >
            <Icon size={16} />
            <AnimatePresence initial={false}>
              {selected === index && (
                <motion.span
                  variants={spanVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="overflow-hidden whitespace-nowrap"
                >
                  {tab.title}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}

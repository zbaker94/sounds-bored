import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import { useIsMd } from "@/hooks/useBreakpoint";
import { cn } from "@/lib/utils";

export interface ClassNames {
  trigger?: string;
  content?: string;
  header?: string;
  title?: string;
  description?: string;
  footer?: string;
  close?: string;
}

export interface Styles {
  trigger?: React.CSSProperties;
  content?: React.CSSProperties;
  header?: React.CSSProperties;
  title?: React.CSSProperties;
  description?: React.CSSProperties;
  footer?: React.CSSProperties;
  close?: React.CSSProperties;
}

export interface DrawerDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  content: React.ReactNode;
  footer: React.ReactNode;
  close?: React.ReactNode;
  classNames?: ClassNames;
  styles?: Styles;
  /** Apply the DeathLetter themed title style. Defaults to true. */
  themed?: boolean;
}

const THEMED_TITLE_CLASS = "font-deathletter tracking-wider text-2xl";

const StandardDialog = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  content,
  footer,
  close,
  classNames,
  styles,
  themed = true,
}: DrawerDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogTrigger
          asChild
          className={classNames?.trigger}
          style={styles?.trigger}
        >
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent className={classNames?.content} style={styles?.content} onEscapeKeyDown={(e) => e.preventDefault()}>
        {(title || description) && (
          <DialogHeader style={styles?.header}>
            {title && <DialogTitle className={cn(themed && THEMED_TITLE_CLASS, classNames?.title)} style={styles?.title}>{title}</DialogTitle>}
            {description && (
              <DialogDescription style={styles?.description}>
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {content}
        </div>
        {(close || footer) && (
          <DialogFooter style={styles?.footer}>
            {footer && footer}
            {close && (
              <DialogClose asChild style={styles?.close}>
                {close}
              </DialogClose>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

const StandardDrawer = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  content,
  footer,
  close,
  classNames,
  styles,
  themed = true,
}: DrawerDialogProps) => {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DrawerTrigger
          asChild
          className={classNames?.trigger}
          style={styles?.trigger}
        >
          {trigger}
        </DrawerTrigger>
      )}
      <DrawerContent className={classNames?.content} style={styles?.content} onEscapeKeyDown={(e) => e.preventDefault()}>
        {(title || description) && (
          <DrawerHeader className="text-left" style={styles?.header}>
            {title && <DrawerTitle className={cn(themed && THEMED_TITLE_CLASS, classNames?.title)} style={styles?.title}>{title}</DrawerTitle>}
          {description && (
            <DrawerDescription
              className={classNames?.description}
              style={styles?.description}
            >
              {description}
            </DrawerDescription>
          )}
        </DrawerHeader>
        )}
        {content}
        {(close || footer) && (
          <DrawerFooter className={classNames?.footer} style={styles?.footer}>
            {footer && footer}
            {close && (
              <DrawerClose
                asChild
                className={classNames?.close}
                style={styles?.close}
              >
                {close}
              </DrawerClose>
            )}
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
};

export const DrawerDialog = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  content,
  footer,
  close,
  classNames,
  styles,
  themed = true,
}: DrawerDialogProps) => {

  const isDesktop = useIsMd();
  if (isDesktop) {
    return (
      <StandardDialog
        open={open}
        onOpenChange={onOpenChange}
        trigger={trigger}
        title={title}
        description={description}
        content={content}
        footer={footer}
        close={close}
        classNames={classNames}
        styles={styles}
        themed={themed}
      />
    );
  } else {
    return (
      <StandardDrawer
        open={open}
        onOpenChange={onOpenChange}
        trigger={trigger}
        title={title}
        description={description}
        content={content}
        footer={footer}
        close={close}
        classNames={classNames}
        styles={styles}
        themed={themed}
      />
    );
  }
};

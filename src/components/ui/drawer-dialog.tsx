import { Button } from "@/components/ui/button";
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

import { useBreakpoint } from "@/hooks/useBreakpoint";

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
}

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
      <DialogContent className={classNames?.content} style={styles?.content}>
        {(title || description) && (
          <DialogHeader style={styles?.header}>
            {title && <DialogTitle style={styles?.title}>{title}</DialogTitle>}
            {description && (
              <DialogDescription style={styles?.description}>
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        {content}
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
      <DrawerContent className={classNames?.content} style={styles?.content}>
        {(title || description) && (
          <DrawerHeader className="text-left" style={styles?.header}>
            {title && <DrawerTitle className={classNames?.title} style={styles?.title}>{title}</DrawerTitle>}
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
}: DrawerDialogProps) => {

  const isSm = useBreakpoint("sm");

  const isDesktop = !isSm;

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
      />
    );
  }
};

import { Ref } from "vue"

export default function setMoveEvent(
  pickerRef: Ref<HTMLElement>,
  top: Ref<number>,
  left: Ref<number>,
  isPickerMove: Ref<boolean>,
  pickerOffset: Ref<{ x: number, y: number }>,
) {
  pickerRef.value.addEventListener('mousedown', (event: MouseEvent) => {
    isPickerMove.value = true
    const { clientX, clientY } = event
    pickerOffset.value = {
      x: clientX - left.value,
      y: clientY - top.value
    }
  })
  pickerRef.value.addEventListener('mousemove', (event: MouseEvent) => {
    if (isPickerMove.value) {
      const { clientX, clientY } = event
      left.value = clientX - pickerOffset.value.x;
      top.value = clientY - pickerOffset.value.y;
    }
  })
  pickerRef.value.addEventListener('mouseup', () => {
    isPickerMove.value = false
  })
}
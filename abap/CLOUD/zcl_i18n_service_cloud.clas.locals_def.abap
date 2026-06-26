CLASS lcl_slot_visitor DEFINITION.
  PUBLIC SECTION.
    INTERFACES if_xco_cds_ann_vt_visitor.
    " iv_textkey = the record key carrying the text for this pass (LABEL, GROUPLABEL, ...)
    METHODS constructor IMPORTING iv_textkey TYPE string DEFAULT 'LABEL'.
    " collected rows of one array annotation: ARRAYINDEX|POSITIONATTR|LABEL
    DATA mt_slots TYPE string_table READ-ONLY.
  PRIVATE SECTION.
    DATA mv_rdepth  TYPE i.
    DATA mv_index   TYPE i.
    DATA mv_name    TYPE string.
    DATA mv_label   TYPE string.
    DATA mv_pos     TYPE string.
    DATA mv_haslbl  TYPE abap_bool.
    DATA mv_textkey TYPE string.
ENDCLASS.
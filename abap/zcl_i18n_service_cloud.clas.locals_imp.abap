CLASS lcl_slot_visitor IMPLEMENTATION.
  METHOD if_xco_cds_ann_vt_visitor~enter_record.
    mv_rdepth = mv_rdepth + 1.
    IF mv_rdepth = 1.
      mv_index = mv_index + 1.
      CLEAR: mv_label, mv_pos, mv_haslbl.
    ENDIF.
  ENDMETHOD.

  METHOD if_xco_cds_ann_vt_visitor~leave_record.
    IF mv_rdepth = 1 AND mv_haslbl = abap_true.
      APPEND |{ mv_index }\|{ mv_pos }\|{ mv_label }| TO mt_slots.
    ENDIF.
    mv_rdepth = mv_rdepth - 1.
  ENDMETHOD.

  METHOD if_xco_cds_ann_vt_visitor~visit_name.
    mv_name = to_upper( iv_name ).
  ENDMETHOD.

  METHOD if_xco_cds_ann_vt_visitor~visit_string.
    IF mv_rdepth = 1 AND mv_name = 'LABEL'.
      mv_label  = io_string->value.
      mv_haslbl = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD if_xco_cds_ann_vt_visitor~visit_number.
    IF mv_rdepth = 1 AND mv_name = 'POSITION'.
      DATA(lr) = io_number->get_value( ).
      FIELD-SYMBOLS <lv> TYPE any.
      ASSIGN lr->* TO <lv>.
      IF <lv> IS ASSIGNED.
        mv_pos = condense( |{ <lv> }| ).
      ENDIF.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
